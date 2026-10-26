//! WebDAV 多设备同步
//!
//! 云端目录结构：
//!   <server>/<remote_dir>/project.yrp   工程数据（媒体以文件名引用）
//!   <server>/<remote_dir>/media/<file>   照片 / 音频 / 视频
//!   <server>/<remote_dir>/sync.json      同步元信息（revision、更新时间、设备名）
//!
//! 采用"增量"策略：只会补齐云端缺失的媒体文件，已存在的不再重复上传，
//! 因此免费 WebDAV 空间的流量足够长期使用。

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::project_file;
use serde::{Deserialize, Serialize};

// ==================== 数据结构 ====================

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSyncMeta {
    #[serde(default)]
    pub revision: u64,
    #[serde(default)]
    pub updated_at: String,
    #[serde(default)]
    pub project_updated_at: String,
    #[serde(default)]
    pub device: String,
    #[serde(default)]
    pub media_count: usize,
    /// 家谱名称，供「从云端恢复」列表展示
    #[serde(default)]
    pub family_name: String,
    /// 云端 project.yrp 的字节数，用于快速判断是否变化
    #[serde(default)]
    pub project_size: u64,
}

#[derive(Debug, Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct PushReport {
    pub revision: u64,
    pub uploaded_media: usize,
    pub skipped_media: usize,
    pub total_media: usize,
    pub uploaded_bytes: u64,
    pub project_bytes: u64,
    pub remote_project_updated_at: String,
    pub remote_existed: bool,
}

#[derive(Debug, Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct PullReport {
    pub downloaded_media: usize,
    pub skipped_media: usize,
    pub total_remote_media: usize,
    pub project_bytes: u64,
    pub backup_path: String,
    pub remote: RemoteSyncMeta,
}

#[derive(Debug, Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct PullProgressEvent {
    pub stage: String,
    pub current: usize,
    pub total: usize,
    pub file_name: String,
    pub message: String,
}

#[derive(Debug, Clone)]
struct RemoteEntry {
    /// 相对 media 根目录的路径，统一用 '/' 分隔（头像等媒体会放在子目录里）
    name: String,
    size: u64,
}

/// PROPFIND 原始响应条目（路径为服务器绝对路径，尚未换算成相对路径）
#[derive(Debug, Clone)]
struct RawEntry {
    path: String,
    size: u64,
    is_dir: bool,
}

// ==================== 工具函数 ====================

fn auth_hint(status: u16) -> String {
    match status {
        401 => "账号或应用密码不正确（坚果云需要「应用密码」，不是登录密码）".to_string(),
        403 => "账号没有该目录的读写权限".to_string(),
        404 => "云端目录不存在".to_string(),
        507 => "云端空间或流量不足".to_string(),
        _ => format!("服务器返回 HTTP {}", status),
    }
}

fn encode_segment(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

fn encode_path(p: &str) -> String {
    p.split('/')
        .map(encode_segment)
        .collect::<Vec<_>>()
        .join("/")
}

fn join_url(base: &str, rel: &str) -> String {
    let b = base.trim_end_matches('/');
    let r = rel.trim_start_matches('/');
    if r.is_empty() {
        format!("{}/", b)
    } else {
        format!("{}/{}", b, encode_path(r))
    }
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(h), Some(l)) = (hex_val(bytes[i + 1]), hex_val(bytes[i + 2])) {
                out.push(h * 16 + l);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn normalize_server(server: &str) -> String {
    let s = server.trim();
    let with_scheme = if s.starts_with("http://") || s.starts_with("https://") {
        s.to_string()
    } else {
        format!("https://{}", s)
    };
    with_scheme.trim_end_matches('/').to_string()
}

fn normalize_dir(dir: &str) -> String {
    dir.trim()
        .trim_matches('/')
        .split('/')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("/")
}

fn build_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(90))
        .connect_timeout(Duration::from_secs(20))
        .user_agent("Yiranji/1.0 (WebDAV Sync)")
        .build()
        .map_err(|e| format!("初始化网络客户端失败: {}", e))
}

fn local_device_name() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "未知设备".to_string())
}

fn now_iso() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // 只做同步时间标记，用 Unix 秒不够直观，交给前端展示时格式化；
    // 这里返回 ISO 需要额外依赖，改用 RFC3339 的极简实现（UTC）
    let days = secs / 86400;
    let rem = secs % 86400;
    let (h, mi, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    let (y, m, d) = civil_from_days(days as i64);
    format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z", y, m, d, h, mi, s)
}

/// Howard Hinnant 的 days -> (year, month, day) 算法
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = (if mp < 10 { mp + 3 } else { mp - 9 }) as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

// ==================== 基础 WebDAV 操作 ====================

async fn ensure_dir(
    client: &reqwest::Client,
    server: &str,
    username: &str,
    password: &str,
    dir: &str,
) -> Result<(), String> {
    let mut acc = String::new();
    for seg in dir.split('/').filter(|s| !s.is_empty()) {
        acc.push_str(seg);
        let url = join_url(server, &acc);
        let resp = client
            .request(reqwest::Method::from_bytes(b"MKCOL").unwrap(), &url)
            .basic_auth(username, Some(password))
            .send()
            .await
            .map_err(|e| format!("连接服务器失败: {}", e))?;
        let code = resp.status().as_u16();
        if code == 401 || code == 403 {
            return Err(auth_hint(code));
        }
        if code != 200 && code != 201 && code != 405 {
            let body = resp.text().await.unwrap_or_default();
            let snippet: String = body.chars().take(160).collect();
            return Err(format!("创建云端目录失败：{} {}", auth_hint(code), snippet));
        }
        acc.push('/');
    }
    Ok(())
}

async fn put_bytes(
    client: &reqwest::Client,
    url: &str,
    username: &str,
    password: &str,
    bytes: Vec<u8>,
) -> Result<(), String> {
    let resp = client
        .put(url)
        .basic_auth(username, Some(password))
        .header("Content-Type", "application/octet-stream")
        .body(bytes)
        .send()
        .await
        .map_err(|e| format!("上传失败: {}", e))?;
    let code = resp.status().as_u16();
    if code == 200 || code == 201 || code == 204 {
        Ok(())
    } else {
        Err(format!("上传失败：{}", auth_hint(code)))
    }
}

/// 返回 None 表示远端不存在
async fn get_bytes(
    client: &reqwest::Client,
    url: &str,
    username: &str,
    password: &str,
) -> Result<Option<Vec<u8>>, String> {
    let resp = client
        .get(url)
        .basic_auth(username, Some(password))
        .send()
        .await
        .map_err(|e| format!("下载失败: {}", e))?;
    let code = resp.status().as_u16();
    if code == 404 {
        return Ok(None);
    }
    if code == 401 || code == 403 {
        return Err(auth_hint(code));
    }
    if code != 200 {
        return Err(format!("下载失败：{}", auth_hint(code)));
    }
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("读取下载内容失败: {}", e))?;
    Ok(Some(bytes.to_vec()))
}

fn tag_name(raw: &str) -> String {
    let head = raw.split_whitespace().next().unwrap_or("").to_lowercase();
    head.split(':').last().unwrap_or("").to_string()
}

/// 把 href 换成解码后的路径部分（兼容部分服务器返回完整 URL 的情况）
fn href_to_path(href: &str) -> String {
    let without_scheme = if let Some(idx) = href.find("://") {
        let tail = &href[idx + 3..];
        match tail.find('/') {
            Some(slash) => &tail[slash..],
            None => "/",
        }
    } else {
        href
    };
    let path_only = without_scheme
        .split(['?', '#'])
        .next()
        .unwrap_or(without_scheme);
    percent_decode(path_only)
}

/// 计算 full 相对 base 的路径，如 base=/dav/yiranji/k1/media、full=/dav/.../media/a/b.jpg → a/b.jpg
fn rel_path_from(full: &str, base: &str) -> Option<String> {
    let f = full.trim_end_matches('/');
    let b = base.trim_end_matches('/');
    if f == b {
        return None;
    }
    let rest = f.strip_prefix(b)?;
    let rest = rest.trim_start_matches('/');
    if rest.is_empty() {
        None
    } else {
        Some(rest.to_string())
    }
}

/// 解析 PROPFIND 的 multistatus。
/// 各家 WebDAV 的命名空间前缀不一致（d: / D: / 无前缀），这里按标签名忽略前缀处理。
fn parse_multistatus(xml: &str) -> Vec<RawEntry> {
    let mut entries: Vec<RawEntry> = Vec::new();
    let mut href = String::new();
    let mut size = 0u64;
    let mut is_dir = false;
    let mut inside = false;
    let mut cursor = 0usize;

    while let Some(open_rel) = xml[cursor..].find('<') {
        let open = cursor + open_rel;
        let close = match xml[open..].find('>') {
            Some(c) => open + c,
            None => break,
        };
        let raw = &xml[open + 1..close];
        let is_close = raw.starts_with('/');
        let name = tag_name(raw.trim_start_matches('/'));
        let is_self_closing = raw.trim_end().ends_with('/');

        match (is_close, name.as_str()) {
            (false, "response") => {
                inside = true;
                href.clear();
                size = 0;
                is_dir = false;
            }
            (true, "response") => {
                if inside && !href.is_empty() {
                    let path = href_to_path(&href);
                    if path.ends_with('/') {
                        is_dir = true;
                    }
                    entries.push(RawEntry { path, size, is_dir });
                }
                inside = false;
            }
            (false, "href") if !is_self_closing => {
                if let Some(end) = xml[close + 1..].find("</") {
                    href = xml[close + 1..close + 1 + end].trim().to_string();
                }
            }
            // <D:collection/> 表示这是一个目录
            (false, "collection") => {
                is_dir = true;
            }
            (false, "getcontentlength") => {
                if let Some(end) = xml[close + 1..].find("</") {
                    size = xml[close + 1..close + 1 + end].trim().parse().unwrap_or(0);
                }
            }
            _ => {}
        }
        cursor = close + 1;
    }

    entries
}

async fn propfind(
    client: &reqwest::Client,
    url: &str,
    username: &str,
    password: &str,
    depth: &str,
) -> Result<Vec<RawEntry>, String> {
    let body = r#"<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:"><d:prop><d:getcontentlength/><d:resourcetype/></d:prop></d:propfind>"#;

    let resp = client
        .request(reqwest::Method::from_bytes(b"PROPFIND").unwrap(), url)
        .basic_auth(username, Some(password))
        .header("Depth", depth)
        .header("Content-Type", "application/xml; charset=utf-8")
        .body(body)
        .send()
        .await
        .map_err(|e| format!("读取云端目录失败: {}", e))?;

    let code = resp.status().as_u16();
    if code == 404 {
        return Ok(Vec::new());
    }
    if code == 401 || code == 403 {
        return Err(auth_hint(code));
    }
    if code != 207 && code != 200 {
        return Err(format!("读取云端目录失败：{}", auth_hint(code)));
    }
    let text = resp.text().await.unwrap_or_default();
    Ok(parse_multistatus(&text))
}

/// 递归列出目录下的所有文件（返回相对该目录的路径）。
///
/// 之所以不用 `Depth: infinity`：坚果云等服务的 PROPFIND 不支持无限深度会直接 403；
/// 而只用 Depth:1 又会漏掉 `media/avatar/circle/`、`media/photo/` 这类子目录里的媒体。
/// 这里用 Depth:1 逐层下钻，兼容性最好。
async fn list_tree(
    client: &reqwest::Client,
    base_url: &str,
    username: &str,
    password: &str,
    max_depth: usize,
) -> Result<Vec<RemoteEntry>, String> {
    let base_path = href_to_path(base_url);
    let mut files: Vec<RemoteEntry> = Vec::new();
    // (目录 URL, 当前深度)
    let mut queue: Vec<(String, usize)> = vec![(base_url.to_string(), 0)];
    let mut visited: std::collections::HashSet<String> = std::collections::HashSet::new();

    while let Some((dir_url, depth)) = queue.pop() {
        if !visited.insert(dir_url.clone()) {
            continue;
        }
        let dir_path = href_to_path(&dir_url);
        for entry in propfind(client, &dir_url, username, password, "1").await? {
            // 相对 media 根目录计算，子目录里的文件才能保持 avatar/circle/xxx_cropped.png 这样的完整路径
            let rel = match rel_path_from(&entry.path, &base_path) {
                Some(r) => r,
                None => continue, // 根目录自身
            };
            if entry.is_dir {
                // 下钻用的 URL 只拼当前层内的相对段，避免重复叠加
                if let Some(child_rel) = rel_path_from(&entry.path, &dir_path) {
                    if depth + 1 <= max_depth {
                        queue.push((
                            format!(
                                "{}/{}",
                                dir_url.trim_end_matches('/'),
                                encode_path(&child_rel)
                            ),
                            depth + 1,
                        ));
                    }
                }
            } else {
                files.push(RemoteEntry {
                    name: rel,
                    size: entry.size,
                });
            }
        }
    }

    Ok(files)
}

async fn read_remote_meta(
    client: &reqwest::Client,
    server: &str,
    dir: &str,
    username: &str,
    password: &str,
) -> Result<Option<RemoteSyncMeta>, String> {
    let url = join_url(server, &format!("{}/sync.json", dir));
    match get_bytes(client, &url, username, password).await? {
        None => Ok(None),
        Some(bytes) => Ok(serde_json::from_slice::<RemoteSyncMeta>(&bytes).ok()),
    }
}

// ==================== 本地文件辅助 ====================

fn collect_media_files(media_dir: &Path) -> Vec<(String, PathBuf, u64)> {
    let mut out = Vec::new();
    if !media_dir.is_dir() {
        return out;
    }
    let mut stack = vec![media_dir.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let entries = match fs::read_dir(&dir) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if let Ok(meta) = entry.metadata() {
                let rel = path
                    .strip_prefix(media_dir)
                    .unwrap_or(&path)
                    .to_string_lossy()
                    .replace('\\', "/");
                out.push((rel, path.clone(), meta.len()));
            }
        }
    }
    out
}

/// 扫描工程 JSON，收集所有被引用的媒体文件名。
/// 这样"已删除的照片"（云端还留着）不会在拉取时又被下载回来，白白消耗流量。
fn collect_referenced_media(value: &serde_json::Value) -> std::collections::HashSet<String> {
    let mut set = std::collections::HashSet::new();
    fn walk(v: &serde_json::Value, set: &mut std::collections::HashSet<String>) {
        match v {
            serde_json::Value::String(s) => {
                let posix = s.replace('\\', "/");
                for marker in ["/media/", "__YIRANJI_MEDIA__/"] {
                    if let Some(idx) = posix.rfind(marker) {
                        let name = &posix[idx + marker.len()..];
                        let name = name.trim_start_matches('/');
                        if !name.is_empty() {
                            set.insert(name.to_string());
                        }
                    }
                }
            }
            serde_json::Value::Array(arr) => {
                for item in arr {
                    walk(item, set);
                }
            }
            serde_json::Value::Object(map) => {
                for (_, item) in map {
                    walk(item, set);
                }
            }
            _ => {}
        }
    }
    walk(value, &mut set);
    set
}

fn backup_current_project(workspace: &Path) -> Result<String, String> {
    let sources = [
        (project_file::PROJECT_FILE_NAME, "yrp"),
        (project_file::LEGACY_PROJECT_FILE_NAME, "json"),
    ];
    if !sources
        .iter()
        .any(|(name, _)| workspace.join(name).is_file())
    {
        return Ok(String::new());
    }
    let stamp = now_iso()
        .replace([':', '-'], "")
        .replace('T', "-")
        .replace('Z', "");
    let backup_dir = workspace.join(".sync-backup");
    fs::create_dir_all(&backup_dir).map_err(|e| format!("创建同步备份目录失败：{}", e))?;
    let mut primary_backup = String::new();
    for (name, extension) in sources {
        let src = workspace.join(name);
        if !src.is_file() {
            continue;
        }
        let dest = backup_dir.join(format!("project-{}.{}", stamp, extension));
        fs::copy(&src, &dest).map_err(|e| format!("备份当前工程失败：{}", e))?;
        let original = fs::read(&src).map_err(|e| format!("回读当前工程失败：{}", e))?;
        let copied = fs::read(&dest).map_err(|e| format!("回读同步备份失败：{}", e))?;
        if original != copied {
            return Err("同步备份校验失败，已中止拉取".to_string());
        }
        if primary_backup.is_empty() {
            primary_backup = dest.to_string_lossy().into_owned();
        }
    }
    Ok(primary_backup)
}

// ==================== Tauri 命令 ====================

/// 测试连接并自动创建云端目录
#[tauri::command]
pub async fn webdav_test(
    server: String,
    username: String,
    password: String,
    remote_dir: String,
) -> Result<String, String> {
    let server = normalize_server(&server);
    let dir = normalize_dir(&remote_dir);
    let client = build_client()?;
    ensure_dir(&client, &server, &username, &password, &dir).await?;
    let url = join_url(&server, &dir);
    propfind(&client, &url, &username, &password, "0").await?;
    Ok(format!("{}/{}", server, dir))
}

/// 读取云端同步元信息（不下载正文，用于"云端是否有更新"的快速判断）
#[tauri::command]
pub async fn webdav_remote_meta(
    server: String,
    username: String,
    password: String,
    remote_dir: String,
) -> Result<Option<RemoteSyncMeta>, String> {
    let server = normalize_server(&server);
    let dir = normalize_dir(&remote_dir);
    let client = build_client()?;
    read_remote_meta(&client, &server, &dir, &username, &password).await
}

/// 上传：project.yrp 全量 + 云端缺失的媒体文件
pub async fn webdav_push(
    server: String,
    username: String,
    password: String,
    remote_dir: String,
    workspace_path: String,
    device: Option<String>,
) -> Result<PushReport, String> {
    webdav_push_with_progress(
        server,
        username,
        password,
        remote_dir,
        workspace_path,
        device,
        |_| {},
    )
    .await
}

/// 带实时进度回调的云端上传实现
pub async fn webdav_push_with_progress<F>(
    server: String,
    username: String,
    password: String,
    remote_dir: String,
    workspace_path: String,
    device: Option<String>,
    mut on_progress: F,
) -> Result<PushReport, String>
where
    F: FnMut(PullProgressEvent),
{
    let server = normalize_server(&server);
    let dir = normalize_dir(&remote_dir);
    let client = build_client()?;
    let workspace = PathBuf::from(&workspace_path);

    let project_path = workspace.join(project_file::PROJECT_FILE_NAME);
    let project_bytes =
        fs::read(&project_path).map_err(|e| format!("读取本地 project.yrp 失败：{}", e))?;
    let project_content = project_file::read_project(&project_path)?;

    on_progress(PullProgressEvent {
        stage: "init".to_string(),
        current: 0,
        total: 0,
        file_name: project_file::PROJECT_FILE_NAME.to_string(),
        message: "正在连接云端并准备上传目录…".to_string(),
    });

    ensure_dir(&client, &server, &username, &password, &dir).await?;

    // 上传前先看云端状态，供调用方判断是否"覆盖了更新版本"
    let previous = read_remote_meta(&client, &server, &dir, &username, &password).await?;
    let remote_existed = previous.is_some();

    let media_dir = workspace.join("media");
    let local_files = collect_media_files(&media_dir);
    // 只同步工程真正引用到的媒体，避免历史遗留的孤儿文件反复占用云端流量
    let project_json: serde_json::Value =
        serde_json::from_str(&project_content).unwrap_or(serde_json::Value::Null);
    let referenced = collect_referenced_media(&project_json);
    let has_filter = !referenced.is_empty();
    let media_url = join_url(&server, &format!("{}/media", dir));
    ensure_dir(
        &client,
        &server,
        &username,
        &password,
        &format!("{}/media", dir),
    )
    .await?;

    on_progress(PullProgressEvent {
        stage: "scan".to_string(),
        current: 0,
        total: 0,
        file_name: "media/".to_string(),
        message: "正在比对云端与本地媒体文件…".to_string(),
    });

    // 递归读取云端媒体：头像在 media/avatar/{circle,rect}/ 下，只列一层会漏
    let remote_files = list_tree(&client, &media_url, &username, &password, 4).await?;
    // 按「相对路径」判断是否已存在，子目录里的同名文件（cropped.jpg）不会被误判
    let remote_sizes: std::collections::HashMap<String, u64> =
        remote_files.into_iter().map(|e| (e.name, e.size)).collect();

    let mut uploaded = 0usize;
    let mut skipped = 0usize;
    let mut uploaded_bytes = 0u64;
    let mut ensured_dirs: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut to_upload: Vec<&(String, PathBuf, u64)> = Vec::new();

    for item in &local_files {
        let (rel, _, size) = item;
        let base_name = rel.rsplit('/').next().unwrap_or(rel);
        if has_filter && !referenced.contains(base_name) && !referenced.contains(rel.as_str()) {
            continue;
        }
        // 同名且大小一致 → 云端已有；大小不同说明被替换过，需要重传
        if let Some(remote_size) = remote_sizes.get(rel.as_str()) {
            if *remote_size == *size || *remote_size == 0 {
                skipped += 1;
                continue;
            }
        }
        to_upload.push(item);
    }

    let total_files = to_upload.len() + 1;
    for (idx, (rel, path, size)) in to_upload.iter().enumerate() {
        let current = idx + 1;
        on_progress(PullProgressEvent {
            stage: "media".to_string(),
            current,
            total: total_files,
            file_name: rel.clone(),
            message: format!(
                "共 {} 个文件 · 正在上传第 {} / {} 个文件…",
                total_files, current, total_files
            ),
        });
        // 先补建云端子目录，否则严格实现的 WebDAV 服务会以 409（父目录不存在）拒绝 PUT
        if let Some((sub, _)) = rel.rsplit_once('/') {
            let remote_sub = format!("{}/media/{}", dir, sub);
            if ensured_dirs.insert(remote_sub.clone()) {
                ensure_dir(&client, &server, &username, &password, &remote_sub).await?;
            }
        }
        if let Ok(bytes) = fs::read(path) {
            let url = join_url(&server, &format!("{}/media/{}", dir, rel));
            put_bytes(&client, &url, &username, &password, bytes).await?;
            uploaded += 1;
            uploaded_bytes += size;
        }
    }

    on_progress(PullProgressEvent {
        stage: "project".to_string(),
        current: total_files,
        total: total_files,
        file_name: project_file::PROJECT_FILE_NAME.to_string(),
        message: format!(
            "共 {} 个文件 · 正在上传第 {} / {} 个文件…",
            total_files, total_files, total_files
        ),
    });

    // 工程数据最后写，保证任何时刻云端都有一份自洽的快照
    let project_url = join_url(&server, &format!("{}/project.yrp", dir));
    let project_size = project_bytes.len() as u64;
    put_bytes(&client, &project_url, &username, &password, project_bytes).await?;

    let project_updated_at = project_json
        .get("meta")
        .and_then(|m| m.get("updatedAt"))
        .and_then(|u| u.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(now_iso);

    let revision = previous.map(|p| p.revision).unwrap_or(0) + 1;
    let family_name = project_json
        .get("meta")
        .and_then(|m| m.get("familyName"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let meta = RemoteSyncMeta {
        revision,
        updated_at: now_iso(),
        project_updated_at: project_updated_at.clone(),
        device: device.unwrap_or_else(local_device_name),
        media_count: local_files.len(),
        family_name,
        project_size,
    };
    let meta_url = join_url(&server, &format!("{}/sync.json", dir));
    let meta_bytes =
        serde_json::to_vec_pretty(&meta).map_err(|e| format!("序列化同步信息失败: {}", e))?;
    put_bytes(&client, &meta_url, &username, &password, meta_bytes).await?;

    Ok(PushReport {
        revision,
        uploaded_media: uploaded,
        skipped_media: skipped,
        total_media: local_files.len(),
        uploaded_bytes,
        project_bytes: project_size,
        remote_project_updated_at: project_updated_at,
        remote_existed,
    })
}

/// 云端家谱条目（换新电脑时用于「从云端恢复」）
#[derive(Debug, Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct RemoteProject {
    /// 云端子目录名，同时也是这台家谱的同步 ID
    pub dir: String,
    pub family_name: String,
    pub revision: u64,
    pub updated_at: String,
    pub project_updated_at: String,
    pub device: String,
    pub media_count: usize,
    pub project_size: u64,
}

/// 列出云端根目录下的所有家谱（只读各自的 sync.json，不下载正文）
#[tauri::command]
pub async fn webdav_list_projects(
    server: String,
    username: String,
    password: String,
    remote_root: String,
) -> Result<Vec<RemoteProject>, String> {
    let server = normalize_server(&server);
    let root = normalize_dir(&remote_root);
    let client = build_client()?;
    let root_url = join_url(&server, &root);
    let base_path = href_to_path(&root_url);

    let mut out: Vec<RemoteProject> = Vec::new();
    for entry in propfind(&client, &root_url, &username, &password, "1").await? {
        if !entry.is_dir {
            continue;
        }
        let dir = match rel_path_from(&entry.path, &base_path) {
            Some(d) => d,
            None => continue,
        };
        let meta = read_remote_meta(
            &client,
            &server,
            &format!("{}/{}", root, dir),
            &username,
            &password,
        )
        .await?
        .unwrap_or_default();
        out.push(RemoteProject {
            dir,
            family_name: meta.family_name,
            revision: meta.revision,
            updated_at: meta.updated_at,
            project_updated_at: meta.project_updated_at,
            device: meta.device,
            media_count: meta.media_count,
            project_size: meta.project_size,
        });
    }
    // 最近更新的排在前面
    out.sort_by(|a, b| b.project_updated_at.cmp(&a.project_updated_at));
    Ok(out)
}

/// 下载：project.yrp（先备份本地）+ 本地缺失的媒体；旧云端 JSON 自动转为 YRP。
pub async fn webdav_pull(
    server: String,
    username: String,
    password: String,
    remote_dir: String,
    workspace_path: String,
) -> Result<PullReport, String> {
    webdav_pull_with_progress(server, username, password, remote_dir, workspace_path, |_| {}).await
}

/// 带实时进度回调的云端拉取实现
pub async fn webdav_pull_with_progress<F>(
    server: String,
    username: String,
    password: String,
    remote_dir: String,
    workspace_path: String,
    mut on_progress: F,
) -> Result<PullReport, String>
where
    F: FnMut(PullProgressEvent),
{
    let server = normalize_server(&server);
    let dir = normalize_dir(&remote_dir);
    let client = build_client()?;
    let workspace = PathBuf::from(&workspace_path);

    on_progress(PullProgressEvent {
        stage: "project".to_string(),
        current: 1,
        total: 0,
        file_name: project_file::PROJECT_FILE_NAME.to_string(),
        message: "正在拉取家谱主档案数据…".to_string(),
    });

    let project_url = join_url(&server, &format!("{}/project.yrp", dir));
    let (project_bytes, legacy_json) =
        match get_bytes(&client, &project_url, &username, &password).await? {
            Some(bytes) => (bytes, false),
            None => {
                let legacy_url = join_url(&server, &format!("{}/project.json", dir));
                let bytes = get_bytes(&client, &legacy_url, &username, &password)
                    .await?
                    .ok_or_else(|| {
                        "云端还没有这个家谱的备份，请先在另一台电脑点「上传到云端」".to_string()
                    })?;
                (bytes, true)
            }
        };

    let remote = read_remote_meta(&client, &server, &dir, &username, &password)
        .await?
        .unwrap_or_default();

    // 任何本地格式都必须先完成可回读验证的备份，失败时不得继续覆盖。
    let backup_path = backup_current_project(&workspace)?;

    let media_dir = workspace.join("media");
    fs::create_dir_all(&media_dir).map_err(|e| format!("创建 media 目录失败: {}", e))?;
    let local_existing: std::collections::HashSet<String> = collect_media_files(&media_dir)
        .into_iter()
        .map(|(rel, _, _)| rel)
        .collect();

    on_progress(PullProgressEvent {
        stage: "scan".to_string(),
        current: 1,
        total: 0,
        file_name: "media/".to_string(),
        message: "正在清点云端媒体文件列表…".to_string(),
    });

    let media_url = join_url(&server, &format!("{}/media", dir));
    // 递归列出，子目录里的头像也要能拉到（工程引用的是 media/avatar/circle/xxx_cropped.png 这类路径）
    let remote_entries = list_tree(&client, &media_url, &username, &password, 4).await?;

    // 只下载工程引用到的文件：云端残留的旧照片不再被拉回本地
    let json_bytes = if legacy_json {
        project_bytes.clone()
    } else {
        project_file::decode_yrp(&project_bytes)?.to_vec()
    };
    let project_json: serde_json::Value =
        serde_json::from_slice(&json_bytes).map_err(|e| format!("云端工程数据无效：{}", e))?;
    let referenced = collect_referenced_media(&project_json);
    let has_filter = !referenced.is_empty();

    let mut downloaded = 0usize;
    let mut skipped = 0usize;
    let mut to_download: Vec<&RemoteEntry> = Vec::new();
    for entry in &remote_entries {
        let base_name = entry.name.rsplit('/').next().unwrap_or(&entry.name);
        if has_filter && !referenced.contains(&entry.name) && !referenced.contains(base_name) {
            continue;
        }
        if local_existing.contains(&entry.name) {
            skipped += 1;
            continue;
        }
        to_download.push(entry);
    }

    let total_files = 1 + to_download.len();
    for (idx, entry) in to_download.iter().enumerate() {
        let current = idx + 2;
        on_progress(PullProgressEvent {
            stage: "media".to_string(),
            current,
            total: total_files,
            file_name: entry.name.clone(),
            message: format!(
                "共 {} 个文件 · 正在拉取第 {} / {} 个文件…",
                total_files, current, total_files
            ),
        });
        let url = join_url(&server, &format!("{}/media/{}", dir, entry.name));
        if let Some(bytes) = get_bytes(&client, &url, &username, &password).await? {
            let dest = media_dir.join(entry.name.replace('/', std::path::MAIN_SEPARATOR_STR));
            if let Some(parent) = dest.parent() {
                let _ = fs::create_dir_all(parent);
            }
            fs::write(&dest, bytes).map_err(|e| format!("写入媒体文件失败: {}", e))?;
            downloaded += 1;
        }
    }

    on_progress(PullProgressEvent {
        stage: "save".to_string(),
        current: total_files,
        total: total_files,
        file_name: project_file::PROJECT_FILE_NAME.to_string(),
        message: format!("共 {} 个文件拉取完成，正在写入本地工作区…", total_files),
    });

    // 媒体补齐后再原子写入 YRP；旧云端 JSON 在本地统一转换。
    let local_project = workspace.join(project_file::PROJECT_FILE_NAME);
    let local_bytes = if legacy_json {
        project_file::encode_yrp(&json_bytes)
    } else {
        project_bytes.clone()
    };
    project_file::atomic_write(&local_project, &local_bytes)?;
    let legacy_workspace_json = workspace.join(project_file::LEGACY_PROJECT_FILE_NAME);
    if legacy_workspace_json.is_file() {
        fs::remove_file(&legacy_workspace_json)
            .map_err(|e| format!("移除旧工作区 project.json 失败：{}", e))?;
    }

    Ok(PullReport {
        downloaded_media: downloaded,
        skipped_media: skipped,
        total_remote_media: remote_entries.len(),
        project_bytes: project_bytes.len() as u64,
        backup_path,
        remote,
    })
}
