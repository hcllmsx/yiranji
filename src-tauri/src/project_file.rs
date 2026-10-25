//! YRP 工作工程文件：16 字节专用文件头 + UTF-8 JSON。

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

pub const PROJECT_FILE_NAME: &str = "project.yrp";
pub const LEGACY_PROJECT_FILE_NAME: &str = "project.json";
pub const YRP_MAGIC: &[u8; 8] = b"YIRANJP\0";
pub const YRP_VERSION: u32 = 1;
pub const YRP_HEADER_SIZE: usize = 16;

pub fn encode_yrp(json: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(YRP_HEADER_SIZE + json.len());
    out.extend_from_slice(YRP_MAGIC);
    out.extend_from_slice(&YRP_VERSION.to_le_bytes());
    out.extend_from_slice(&0u32.to_le_bytes());
    out.extend_from_slice(json);
    out
}

pub fn decode_yrp(data: &[u8]) -> Result<&[u8], String> {
    if data.len() < YRP_HEADER_SIZE {
        return Err("YRP 文件太小，不是有效的以苒纪工程文件".to_string());
    }
    if &data[..8] != YRP_MAGIC {
        return Err("YRP 文件标识不匹配".to_string());
    }
    let mut version_bytes = [0u8; 4];
    version_bytes.copy_from_slice(&data[8..12]);
    let version = u32::from_le_bytes(version_bytes);
    if version != YRP_VERSION {
        return Err(format!("Unsupported YRP file version: {}", version));
    }
    if data[12..16] != [0, 0, 0, 0] {
        return Err("YRP 文件包含当前版本不支持的标志".to_string());
    }
    Ok(&data[YRP_HEADER_SIZE..])
}

pub fn read_project(path: &Path) -> Result<String, String> {
    let data = fs::read(path)
        .map_err(|e| format!("读取工程文件失败：{}（{}）", e, path.to_string_lossy()))?;
    let json = if path
        .extension()
        .map(|ext| ext.eq_ignore_ascii_case("yrp"))
        .unwrap_or(false)
    {
        decode_yrp(&data)?.to_vec()
    } else {
        data
    };
    String::from_utf8(json)
        .map_err(|_| format!("工程数据不是有效的 UTF-8：{}", path.to_string_lossy()))
}

pub fn atomic_write(path: &Path, data: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("无法确定文件所在目录：{}", path.to_string_lossy()))?;
    fs::create_dir_all(parent).map_err(|e| format!("创建工程目录失败：{}", e))?;

    let mut temp = tempfile::NamedTempFile::new_in(parent)
        .map_err(|e| format!("创建临时工程文件失败：{}", e))?;
    temp.write_all(data)
        .map_err(|e| format!("写入临时工程文件失败：{}", e))?;
    temp.as_file()
        .sync_all()
        .map_err(|e| format!("刷新工程文件到磁盘失败：{}", e))?;
    temp.persist(path)
        .map_err(|e| format!("替换工程文件失败：{}", e.error))?;
    Ok(())
}

pub fn write_project(path: &Path, json_content: &str) -> Result<(), String> {
    // 在添加文件头之前先拒绝无效 JSON，避免生成无法再次打开的 YRP。
    serde_json::from_str::<serde_json::Value>(json_content)
        .map_err(|e| format!("工程数据不是有效 JSON：{}", e))?;
    atomic_write(path, &encode_yrp(json_content.as_bytes()))
}

pub fn write_workspace_project(workspace: &Path, json_content: &str) -> Result<PathBuf, String> {
    let path = workspace.join(PROJECT_FILE_NAME);
    write_project(&path, json_content)?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn yrp_roundtrip_preserves_json() {
        let json = r#"{"meta":{"familyName":"测试家谱"},"persons":{}}"#.as_bytes();
        let encoded = encode_yrp(json);
        assert_eq!(&encoded[..8], YRP_MAGIC);
        assert_eq!(decode_yrp(&encoded).unwrap(), json);
    }

    #[test]
    fn yrp_rejects_plain_json_and_unknown_version() {
        assert!(decode_yrp(br#"{"meta":{},"persons":{}}"#).is_err());
        let mut encoded = encode_yrp(b"{}");
        encoded[8..12].copy_from_slice(&2u32.to_le_bytes());
        assert!(decode_yrp(&encoded)
            .unwrap_err()
            .contains("Unsupported YRP file version: 2"));
    }

    #[test]
    fn project_file_is_written_with_header() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(PROJECT_FILE_NAME);
        write_project(&path, r#"{"meta":{},"persons":{}}"#).unwrap();
        let raw = fs::read(&path).unwrap();
        assert_eq!(&raw[..8], YRP_MAGIC);
        assert_eq!(read_project(&path).unwrap(), r#"{"meta":{},"persons":{}}"#);
    }
}
