use std::fs;
use std::path::PathBuf;
use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use hmac::Hmac;
use pbkdf2::pbkdf2;
use rand::RngCore;
use sha2::Sha256;
use tauri::Manager;

type HmacSha256 = Hmac<Sha256>;

const ENC_PREFIX: &str = "enc:v1:";

/// 稳态应用保管库种子：确保密钥派生在任何系统改动（如改计算机名、换硬件、重装系统、跨机迁移）下永远保持稳定
const VAULT_MASTER_SEED: &[u8] = b"yrj_vault_v1_fixed_seed_7f3b9c1d2e8a4506b12d3e4f5a6b7c8d";

/// 结合稳态种子与随机 Salt，通过 PBKDF2 进行 10,000 次哈希迭代派生 256 位 AES 密钥
fn derive_vault_key(salt: &[u8; 16]) -> [u8; 32] {
    let mut key = [0u8; 32];
    pbkdf2::<HmacSha256>(VAULT_MASTER_SEED, salt, 10000, &mut key)
        .expect("PBKDF2 derivation failed");
    key
}

/// 使用 AES-256-GCM 高强度加密敏感字符串（如 WebDAV 密码）
pub fn encrypt_secret(plain: &str) -> Result<String, String> {
    if plain.is_empty() {
        return Ok(String::new());
    }
    let mut salt = [0u8; 16];
    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut salt);
    rand::thread_rng().fill_bytes(&mut nonce_bytes);

    let key_bytes = derive_vault_key(&salt);
    let key = Key::<Aes256Gcm>::from_slice(&key_bytes);
    let cipher = Aes256Gcm::new(key);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plain.as_bytes())
        .map_err(|e| format!("加密失败: {}", e))?;

    let salt_b64 = STANDARD.encode(salt);
    let nonce_b64 = STANDARD.encode(nonce_bytes);
    let ct_b64 = STANDARD.encode(ciphertext);

    Ok(format!("{}{}:{}:{}", ENC_PREFIX, salt_b64, nonce_b64, ct_b64))
}

/// 解密敏感字符串，若不是 enc:v1: 前缀则兼容明文
pub fn decrypt_secret(secret: &str) -> Result<String, String> {
    if secret.is_empty() {
        return Ok(String::new());
    }
    if !secret.starts_with(ENC_PREFIX) {
        return Ok(secret.to_string());
    }

    let payload = &secret[ENC_PREFIX.len()..];
    let parts: Vec<&str> = payload.split(':').collect();
    if parts.len() != 3 {
        return Err("密文格式错误".to_string());
    }

    let salt_vec = STANDARD.decode(parts[0]).map_err(|e| format!("Salt 解码失败: {}", e))?;
    let nonce_vec = STANDARD.decode(parts[1]).map_err(|e| format!("Nonce 解码失败: {}", e))?;
    let ct_vec = STANDARD.decode(parts[2]).map_err(|e| format!("密文解码失败: {}", e))?;

    if salt_vec.len() != 16 {
        return Err("Salt 长度非法".to_string());
    }
    if nonce_vec.len() != 12 {
        return Err("Nonce 长度非法".to_string());
    }

    let mut salt = [0u8; 16];
    salt.copy_from_slice(&salt_vec);

    let nonce = Nonce::from_slice(&nonce_vec);

    let vault_key_bytes = derive_vault_key(&salt);
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&vault_key_bytes));
    let decrypted = cipher
        .decrypt(nonce, ct_vec.as_ref())
        .map_err(|_| "解密失败：密码凭据格式损坏或密钥不匹配".to_string())?;

    String::from_utf8(decrypted).map_err(|e| format!("UTF8 解码失败: {}", e))
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SyncConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub server: String,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub password: String,
    #[serde(default = "default_remote_root")]
    pub remote_root: String,
    #[serde(default = "default_true")]
    pub auto_check: bool,
    #[serde(default)]
    pub auto_push: bool,
    #[serde(default)]
    pub force_overwrite: bool,
}

fn default_remote_root() -> String {
    "yiranji".to_string()
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AppPrefsConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_save_dir: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tree_layout_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sample_dismissed_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sync: Option<SyncConfig>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prefs: Option<AppPrefsConfig>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recent_projects: Option<Vec<serde_json::Value>>,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

/// 获取 settings.json 物理存放路径：C:\Users\<user>\AppData\Roaming\com.yiranji.desktop\settings.json
pub fn get_settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("获取应用配置目录失败: {}", e))?;
    fs::create_dir_all(&dir).map_err(|e| format!("创建配置目录失败: {}", e))?;
    Ok(dir.join("settings.json"))
}

/// 读取设置：从 settings.json 读取并把加密的 WebDAV 密码解密为明文返回给前端
#[tauri::command]
pub fn load_app_settings(app: tauri::AppHandle) -> Result<AppSettings, String> {
    let path = get_settings_path(&app)?;
    if !path.exists() {
        return Ok(AppSettings::default());
    }

    let content = fs::read_to_string(&path)
        .map_err(|e| format!("读取 settings.json 失败: {}", e))?;

    let mut settings: AppSettings = serde_json::from_str(&content)
        .map_err(|e| format!("解析 settings.json 失败: {}", e))?;

    // 解密 sync.password
    if let Some(sync) = &mut settings.sync {
        if !sync.password.is_empty() {
            match decrypt_secret(&sync.password) {
                Ok(plain) => sync.password = plain,
                Err(err) => {
                    log::warn!("WebDAV 密码解密异常: {}", err);
                    // 解密失败时不覆写，保留原值或清空防报错
                }
            }
        }
    }

    Ok(settings)
}

/// 保存设置：将前端传入的设置落盘。落盘前将明文 WebDAV 密码进行高强度加密混淆
#[tauri::command]
pub fn save_app_settings(app: tauri::AppHandle, settings: AppSettings) -> Result<AppSettings, String> {
    let path = get_settings_path(&app)?;

    // 复制一份用于写入文件（写入文件时进行密码加密）
    let mut file_settings = settings.clone();
    if let Some(sync) = &mut file_settings.sync {
        if !sync.password.is_empty() && !sync.password.starts_with(ENC_PREFIX) {
            sync.password = encrypt_secret(&sync.password)?;
        }
    }

    let json = serde_json::to_string_pretty(&file_settings)
        .map_err(|e| format!("序列化 settings.json 失败: {}", e))?;

    fs::write(&path, json).map_err(|e| format!("写入 settings.json 失败: {}", e))?;

    // 返回内存中明文密码的版本，以便前端直接同步状态
    Ok(settings)
}

/// 获取 settings.json 文件的绝对路径（供界面展示或定位）
#[tauri::command]
pub fn get_settings_file_path(app: tauri::AppHandle) -> Result<String, String> {
    let path = get_settings_path(&app)?;
    Ok(path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_secret_encryption_roundtrip() {
        let original = "my_dav_secret_password_123456";
        let encrypted = encrypt_secret(original).expect("encryption failed");
        assert!(encrypted.starts_with(ENC_PREFIX));
        assert_ne!(encrypted, original);

        let decrypted = decrypt_secret(&encrypted).expect("decryption failed");
        assert_eq!(decrypted, original);
    }

    #[test]
    fn test_plain_text_backward_compatibility() {
        let plain = "pure_plain_password";
        let result = decrypt_secret(plain).expect("fallback failed");
        assert_eq!(result, plain);
    }

    #[test]
    fn test_cross_machine_stability() {
        let original = "my_vault_stable_password_987654";
        let encrypted = encrypt_secret(original).expect("encryption failed");

        // 模拟用户改了计算机名、重装系统环境等变动
        std::env::set_var("COMPUTERNAME", "BRAND_NEW_DESKTOP_NAME");
        std::env::set_var("USERNAME", "NEW_WINDOWS_USER");

        let decrypted = decrypt_secret(&encrypted).expect("decryption failed after env change");
        assert_eq!(decrypted, original);
    }
}
