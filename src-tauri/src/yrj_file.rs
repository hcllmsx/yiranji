use crate::project_file;
use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use hmac::Hmac;
use pbkdf2::pbkdf2;
use rand::RngCore;
use sha2::Sha256;
use std::fs;
use std::io::{Cursor, Read, Write};
use std::path::{Path, PathBuf};
use zip::write::FileOptions;
use zip::{ZipArchive, ZipWriter};

const MAGIC: &[u8; 8] = b"YIRANJI\0";
const VERSION: u32 = 2;

type HmacSha256 = Hmac<Sha256>;

/// 从密码派生 256 位密钥
fn derive_key(password: &str, salt: &[u8; 32]) -> [u8; 32] {
    let mut key = [0u8; 32];
    pbkdf2::<HmacSha256>(password.as_bytes(), salt, 10000, &mut key)
        .expect("PBKDF2 derivation failed");
    key
}

/// 遍历工作区目录，将 project.yrp 及 media 压入内存 ZIP
pub fn zip_workspace(workspace_path: &str) -> Result<Vec<u8>, String> {
    let mut buf = Vec::new();
    {
        let mut zip = ZipWriter::new(Cursor::new(&mut buf));
        let options = FileOptions::default().compression_method(zip::CompressionMethod::Deflated);

        // 1. 新包统一放入 project.yrp；极端情况下读取旧工作区时也现场转换。
        let workspace = Path::new(workspace_path);
        let yrp_path = workspace.join(project_file::PROJECT_FILE_NAME);
        let legacy_path = workspace.join(project_file::LEGACY_PROJECT_FILE_NAME);
        let project_data = if yrp_path.is_file() {
            fs::read(&yrp_path).map_err(|e| format!("读取 project.yrp 失败：{}", e))?
        } else if legacy_path.is_file() {
            let json =
                fs::read(&legacy_path).map_err(|e| format!("读取旧版 project.json 失败：{}", e))?;
            serde_json::from_slice::<serde_json::Value>(&json)
                .map_err(|e| format!("旧版工程 JSON 无效：{}", e))?;
            project_file::encode_yrp(&json)
        } else {
            return Err("工作区缺少 project.yrp，无法导出 YRJ".to_string());
        };
        project_file::decode_yrp(&project_data)?;
        zip.start_file(project_file::PROJECT_FILE_NAME, options)
            .map_err(|e| e.to_string())?;
        zip.write_all(&project_data).map_err(|e| e.to_string())?;

        // 2. 压入 media 目录下的全部媒体文件（递归，含 photo/、avatar/ 等分类子目录）
        let media_dir = PathBuf::from(format!("{}/media", workspace_path));
        if media_dir.is_dir() {
            let mut stack = vec![media_dir.clone()];
            while let Some(dir) = stack.pop() {
                for entry in fs::read_dir(&dir).map_err(|e| format!("遍历 media 失败: {}", e))?
                {
                    let entry = entry.map_err(|e| e.to_string())?;
                    let path = entry.path();
                    if path.is_dir() {
                        stack.push(path);
                        continue;
                    }
                    if !path.is_file() {
                        continue;
                    }
                    // 保留相对 media 的目录层级，解包后才能还原 media/avatar/circle/xxx_cropped.png
                    let rel = path
                        .strip_prefix(&media_dir)
                        .unwrap_or(&path)
                        .to_string_lossy()
                        .replace('\\', "/");
                    let archive_name = format!("media/{}", rel);
                    let file_data =
                        fs::read(&path).map_err(|e| format!("读取媒体文件失败: {}", e))?;
                    zip.start_file(&archive_name, options)
                        .map_err(|e| e.to_string())?;
                    zip.write_all(&file_data).map_err(|e| e.to_string())?;
                }
            }
        }
        zip.finish().map_err(|e| e.to_string())?;
    }
    Ok(buf)
}

/// 将内存 ZIP 解密解压释放到目标工作区；v1 的包内 JSON 会现场转换为 YRP。
pub fn unzip_to_workspace(
    zip_data: &[u8],
    dest_workspace: &str,
    version: u32,
) -> Result<(), String> {
    let mut archive =
        ZipArchive::new(Cursor::new(zip_data)).map_err(|e| format!("打开 ZIP 数据失败：{}", e))?;
    let workspace = Path::new(dest_workspace);
    let media_dir = workspace.join("media");
    fs::create_dir_all(&media_dir).map_err(|e| format!("创建 media 文件夹失败：{}", e))?;
    let mut has_project = false;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
        let outpath = match file.enclosed_name() {
            Some(path) => path.to_owned(),
            None => return Err("YRJ 包含不安全的文件路径".to_string()),
        };
        let is_v1_project = version == 1 && outpath == Path::new("project.json");
        let is_v2_project = version == 2 && outpath == Path::new(project_file::PROJECT_FILE_NAME);
        let dest_file_path = if is_v1_project {
            workspace.join(project_file::PROJECT_FILE_NAME)
        } else {
            workspace.join(&outpath)
        };

        if file.name().ends_with('/') {
            fs::create_dir_all(&dest_file_path).map_err(|e| e.to_string())?;
            continue;
        }
        if let Some(parent) = dest_file_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }

        if is_v1_project || is_v2_project {
            let mut data = Vec::new();
            file.read_to_end(&mut data)
                .map_err(|e| format!("读取包内工程失败：{}", e))?;
            let yrp = if is_v1_project {
                serde_json::from_slice::<serde_json::Value>(&data)
                    .map_err(|e| format!("旧版包内 project.json 无效：{}", e))?;
                project_file::encode_yrp(&data)
            } else {
                project_file::decode_yrp(&data)?;
                data
            };
            project_file::atomic_write(&dest_file_path, &yrp)?;
            has_project = true;
        } else {
            let mut outfile = fs::File::create(&dest_file_path)
                .map_err(|e| format!("创建解压文件失败：{}", e))?;
            std::io::copy(&mut file, &mut outfile)
                .map_err(|e| format!("写入解压文件失败：{}", e))?;
        }
    }
    if !has_project {
        return Err("YRJ 文件包中缺少工程数据".to_string());
    }
    Ok(())
}

/// 序列化工作区至加密/明文的 .yrj 自定义二进制数据
pub fn serialize_yrj_workspace(
    workspace_path: &str,
    password: Option<String>,
) -> Result<Vec<u8>, String> {
    let zip_payload = zip_workspace(workspace_path)?;

    let mut file_data = Vec::new();
    file_data.extend_from_slice(MAGIC);
    file_data.extend_from_slice(&VERSION.to_le_bytes());

    if let Some(pwd) = password {
        if pwd.is_empty() {
            return Err("Password cannot be empty if specified".to_string());
        }

        // bit0 = 1 代表加密
        file_data.push(1);

        let mut salt = [0u8; 32];
        let mut iv = [0u8; 12];
        rand::thread_rng().fill_bytes(&mut salt);
        rand::thread_rng().fill_bytes(&mut iv);

        file_data.extend_from_slice(&salt);
        file_data.extend_from_slice(&iv);

        let key = derive_key(&pwd, &salt);
        let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));
        let encrypted_zip = cipher
            .encrypt(Nonce::from_slice(&iv), zip_payload.as_slice())
            .map_err(|e| format!("AES Encryption failed: {}", e))?;

        file_data.extend_from_slice(&encrypted_zip);
    } else {
        // 明文
        file_data.push(0);
        file_data.extend_from_slice(&[0u8; 32]);
        file_data.extend_from_slice(&[0u8; 12]);
        file_data.extend_from_slice(&zip_payload);
    }

    Ok(file_data)
}

/// 解密解压释放 .yrj 自定义二进制数据至目标工作区
pub fn deserialize_yrj_workspace(
    data: &[u8],
    dest_workspace: &str,
    password: Option<String>,
) -> Result<(), String> {
    if data.len() < 57 {
        return Err("File is too small to be a valid .yrj file".to_string());
    }

    if &data[0..8] != MAGIC {
        return Err("Invalid file format: magic header mismatch".to_string());
    }

    let mut ver_bytes = [0u8; 4];
    ver_bytes.copy_from_slice(&data[8..12]);
    let version = u32::from_le_bytes(ver_bytes);
    if version != 1 && version != VERSION {
        return Err(format!("Unsupported file version: {}", version));
    }

    let flags = data[12];
    let is_encrypted = (flags & 1) != 0;

    let mut salt = [0u8; 32];
    salt.copy_from_slice(&data[13..45]);
    let mut iv = [0u8; 12];
    iv.copy_from_slice(&data[45..57]);

    let payload = &data[57..];

    let zip_payload = if is_encrypted {
        let pwd = password.ok_or_else(|| {
            "This file is password protected. Please enter the password.".to_string()
        })?;
        if pwd.is_empty() {
            return Err("Password cannot be empty".to_string());
        }

        let key = derive_key(&pwd, &salt);
        let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));
        cipher
            .decrypt(Nonce::from_slice(&iv), payload)
            .map_err(|_| "Incorrect password or corrupted data".to_string())?
    } else {
        if password.is_some() && !password.unwrap().is_empty() {
            return Err("This file is not encrypted, but a password was provided.".to_string());
        }
        payload.to_vec()
    };

    unzip_to_workspace(&zip_payload, dest_workspace, version)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("yiranji-yrj-{}-{}", tag, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn prepare_workspace(tag: &str) -> PathBuf {
        let dir = temp_dir(tag);
        fs::create_dir_all(dir.join("media").join("photo")).unwrap();
        fs::create_dir_all(dir.join("media").join("avatar").join("circle")).unwrap();
        project_file::write_project(
            &dir.join(project_file::PROJECT_FILE_NAME),
            "{\"meta\":{},\"persons\":{}}",
        )
        .unwrap();
        fs::write(dir.join("media").join("photo").join("a.jpg"), vec![1u8; 10]).unwrap();
        fs::write(
            dir.join("media")
                .join("avatar")
                .join("circle")
                .join("a_cropped.png"),
            vec![2u8; 20],
        )
        .unwrap();
        dir
    }

    fn assert_restored(dest: &PathBuf) {
        assert!(
            dest.join(project_file::PROJECT_FILE_NAME).is_file(),
            "project.yrp 应被还原"
        );
        assert!(
            !dest.join("project.json").exists(),
            "不应再还原旧版 project.json"
        );
        assert!(
            dest.join("media").join("photo").join("a.jpg").is_file(),
            "photo 子目录里的照片应被还原"
        );
        assert!(
            dest.join("media")
                .join("avatar")
                .join("circle")
                .join("a_cropped.png")
                .is_file(),
            "avatar 子目录里的头像应被还原"
        );
        assert_eq!(
            fs::metadata(
                dest.join("media")
                    .join("avatar")
                    .join("circle")
                    .join("a_cropped.png")
            )
            .unwrap()
            .len(),
            20,
            "还原的文件内容应一致"
        );
    }

    #[test]
    fn yrj_roundtrip_keeps_nested_media() {
        let src = prepare_workspace("plain-src");
        let data = serialize_yrj_workspace(src.to_str().unwrap(), None).unwrap();
        let dest = temp_dir("plain-dest");
        deserialize_yrj_workspace(&data, dest.to_str().unwrap(), None).unwrap();
        assert_restored(&dest);
    }

    #[test]
    fn yrj_roundtrip_encrypted_keeps_nested_media() {
        let src = prepare_workspace("enc-src");
        let data = serialize_yrj_workspace(src.to_str().unwrap(), Some("p@ssw0rd".into())).unwrap();
        let dest = temp_dir("enc-dest");
        deserialize_yrj_workspace(&data, dest.to_str().unwrap(), Some("p@ssw0rd".into())).unwrap();
        assert_restored(&dest);
    }

    #[test]
    fn yrj_v1_project_json_is_converted_to_yrp() {
        let mut zip_buf = Vec::new();
        {
            let mut zip = ZipWriter::new(Cursor::new(&mut zip_buf));
            let options = FileOptions::default();
            zip.start_file("project.json", options).unwrap();
            zip.write_all(r#"{"meta":{"familyName":"旧档案"},"persons":{}}"#.as_bytes())
                .unwrap();
            zip.finish().unwrap();
        }
        let mut data = Vec::new();
        data.extend_from_slice(MAGIC);
        data.extend_from_slice(&1u32.to_le_bytes());
        data.push(0);
        data.extend_from_slice(&[0u8; 32]);
        data.extend_from_slice(&[0u8; 12]);
        data.extend_from_slice(&zip_buf);

        let dest = temp_dir("v1-dest");
        deserialize_yrj_workspace(&data, dest.to_str().unwrap(), None).unwrap();
        let project = dest.join(project_file::PROJECT_FILE_NAME);
        assert!(project.is_file());
        assert!(!dest.join("project.json").exists());
        assert!(project_file::read_project(&project)
            .unwrap()
            .contains("旧档案"));
    }
}
