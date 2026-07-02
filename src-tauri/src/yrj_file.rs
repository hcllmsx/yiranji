use std::io::{Cursor, Write};
use std::fs;
use rand::RngCore;
use pbkdf2::pbkdf2;
use sha2::Sha256;
use hmac::Hmac;
use aes_gcm::{Aes256Gcm, Key, Nonce};
use aes_gcm::aead::{Aead, KeyInit};
use zip::{ZipWriter, ZipArchive};
use zip::write::FileOptions;

const MAGIC: &[u8; 8] = b"YIRANJI\0";
const VERSION: u32 = 1;

type HmacSha256 = Hmac<Sha256>;

/// 从密码派生 256 位密钥
fn derive_key(password: &str, salt: &[u8; 32]) -> [u8; 32] {
    let mut key = [0u8; 32];
    pbkdf2::<HmacSha256>(password.as_bytes(), salt, 10000, &mut key)
        .expect("PBKDF2 derivation failed");
    key
}

/// 遍历工作区目录，将 project.json 及 media 压入内存 ZIP
pub fn zip_workspace(workspace_path: &str) -> Result<Vec<u8>, String> {
    let mut buf = Vec::new();
    {
        let mut zip = ZipWriter::new(Cursor::new(&mut buf));
        let options = FileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);

        // 1. 压入 project.json
        let json_path = format!("{}/project.json", workspace_path);
        if std::path::Path::new(&json_path).exists() {
            let json_data = fs::read(&json_path).map_err(|e| format!("读取 project.json 失败: {}", e))?;
            zip.start_file("project.json", options).map_err(|e| e.to_string())?;
            zip.write_all(&json_data).map_err(|e| e.to_string())?;
        }

        // 2. 压入 media 目录下的全部照片文件
        let media_dir = format!("{}/media", workspace_path);
        if std::path::Path::new(&media_dir).exists() {
            for entry in fs::read_dir(&media_dir).map_err(|e| format!("遍历 media 失败: {}", e))? {
                let entry = entry.map_err(|e| e.to_string())?;
                let path = entry.path();
                if path.is_file() {
                    let file_name = path.file_name().unwrap().to_string_lossy();
                    let archive_name = format!("media/{}", file_name);
                    let file_data = fs::read(&path).map_err(|e| format!("读取媒体文件失败: {}", e))?;
                    zip.start_file(&archive_name, options).map_err(|e| e.to_string())?;
                    zip.write_all(&file_data).map_err(|e| e.to_string())?;
                }
            }
        }
        zip.finish().map_err(|e| e.to_string())?;
    }
    Ok(buf)
}

/// 将内存 ZIP 解密解压释放到目标工作区目录中
pub fn unzip_to_workspace(zip_data: &[u8], dest_workspace: &str) -> Result<(), String> {
    let mut archive = ZipArchive::new(Cursor::new(zip_data)).map_err(|e| format!("打开 ZIP 数据失败: {}", e))?;
    let media_dir = format!("{}/media", dest_workspace);
    fs::create_dir_all(&media_dir).map_err(|e| format!("创建 media 文件夹失败: {}", e))?;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
        let outpath = match file.enclosed_name() {
            Some(path) => path.to_owned(),
            None => continue,
        };

        let file_name = outpath.to_string_lossy().to_string();
        let dest_file_path = format!("{}/{}", dest_workspace, file_name);

        if file.name().ends_with('/') {
            fs::create_dir_all(&dest_file_path).map_err(|e| e.to_string())?;
        } else {
            if let Some(p) = std::path::Path::new(&dest_file_path).parent() {
                if !p.exists() {
                    fs::create_dir_all(p).map_err(|e| e.to_string())?;
                }
            }
            let mut outfile = fs::File::create(&dest_file_path).map_err(|e| format!("创建解压文件失败: {}", e))?;
            std::io::copy(&mut file, &mut outfile).map_err(|e| format!("写入解压文件失败: {}", e))?;
        }
    }
    Ok(())
}

/// 序列化工作区至加密/明文的 .yrj 自定义二进制数据
pub fn serialize_yrj_workspace(workspace_path: &str, password: Option<String>) -> Result<Vec<u8>, String> {
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
pub fn deserialize_yrj_workspace(data: &[u8], dest_workspace: &str, password: Option<String>) -> Result<(), String> {
    if data.len() < 57 {
        return Err("File is too small to be a valid .yrj file".to_string());
    }

    if &data[0..8] != MAGIC {
        return Err("Invalid file format: magic header mismatch".to_string());
    }

    let mut ver_bytes = [0u8; 4];
    ver_bytes.copy_from_slice(&data[8..12]);
    let version = u32::from_le_bytes(ver_bytes);
    if version != 1 {
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
        let pwd = password.ok_or_else(|| "This file is password protected. Please enter the password.".to_string())?;
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

    unzip_to_workspace(&zip_payload, dest_workspace)
}
