pub mod webdav;
mod yrj_file;

use std::fs;
use std::io::Read;
use std::path::PathBuf;
use tauri::Manager;

#[tauri::command]
fn select_yrj_file_path_for_save(default_name: String) -> Result<Option<String>, String> {
    let file = rfd::FileDialog::new()
        .add_filter("以苒纪工程文件 (*.yrj)", &["yrj"])
        .set_file_name(&default_name)
        .save_file();
    
    Ok(file.map(|p| p.to_string_lossy().into_owned()))
}

#[tauri::command]
fn select_zip_file_path_for_save(default_name: String) -> Result<Option<String>, String> {
    let file = rfd::FileDialog::new()
        .add_filter("ZIP 压缩包 (*.zip)", &["zip"])
        .set_file_name(&default_name)
        .save_file();
    
    Ok(file.map(|p| p.to_string_lossy().into_owned()))
}

#[tauri::command]
fn select_export_file_path(default_name: String, filter_name: String, extensions: Vec<String>) -> Result<Option<String>, String> {
    let file = rfd::FileDialog::new()
        .add_filter(&filter_name, &extensions)
        .set_file_name(&default_name)
        .save_file();
    
    Ok(file.map(|p| p.to_string_lossy().into_owned()))
}

#[tauri::command]
fn select_yrj_file_path_for_open() -> Result<Option<String>, String> {
    let file = rfd::FileDialog::new()
        .add_filter("以苒纪工程文件 (*.yrj)", &["yrj"])
        .pick_file();
    
    Ok(file.map(|p| p.to_string_lossy().into_owned()))
}

#[tauri::command]
fn select_project_parent_dir(default_dir: Option<String>) -> Result<Option<String>, String> {
    let mut dialog = rfd::FileDialog::new();
    if let Some(dir) = default_dir {
        let p = PathBuf::from(&dir);
        if p.is_dir() {
            dialog = dialog.set_directory(p);
        }
    }
    let dir = dialog.pick_folder();

    Ok(dir.map(|p| p.to_string_lossy().into_owned()))
}

/// 在系统文件管理器中打开指定路径（目录直接打开，文件则定位并选中）
#[tauri::command]
fn open_in_explorer(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err(format!("路径不存在：{}", path));
    }

    #[cfg(target_os = "windows")]
    let result = {
        let win_path = path.replace('/', "\\");
        let arg = if p.is_dir() {
            win_path
        } else {
            format!("/select,{}", win_path)
        };
        std::process::Command::new("explorer").arg(arg).spawn().map(|_| ())
    };

    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open").arg(&path).spawn().map(|_| ());

    #[cfg(all(unix, not(target_os = "macos")))]
    let result = std::process::Command::new("xdg-open").arg(&path).spawn().map(|_| ());

    result.map_err(|e| format!("打开文件管理器失败：{}", e))
}

/// 递归复制目录
fn copy_dir_all(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let target = dst.join(entry.file_name());
        if file_type.is_dir() {
            copy_dir_all(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

/// 递归把 JSON 中所有字符串里的旧路径前缀替换为新路径
fn rewrite_path_prefix(value: &mut serde_json::Value, from: &str, to: &str) {
    match value {
        serde_json::Value::String(s) => {
            if s.contains(from) {
                *s = s.replace(from, to);
            }
        }
        serde_json::Value::Array(items) => {
            items.iter_mut().for_each(|item| rewrite_path_prefix(item, from, to));
        }
        serde_json::Value::Object(map) => {
            map.values_mut().for_each(|v| rewrite_path_prefix(v, from, to));
        }
        _ => {}
    }
}

/// 将整个档案工作区复制到新的父目录下，并修正 project.json 内的绝对媒体路径
#[tauri::command]
fn move_project_workspace(from_workspace: String, to_parent_dir: String) -> Result<String, String> {
    let from = PathBuf::from(&from_workspace);
    if !from.is_dir() {
        return Err(format!("原档案目录不存在：{}", from_workspace));
    }

    let folder_name = from
        .file_name()
        .and_then(|s| s.to_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "无法识别原档案目录名".to_string())?;

    let to_parent = PathBuf::from(&to_parent_dir);
    if !to_parent.is_dir() {
        return Err(format!("目标目录不存在：{}", to_parent_dir));
    }

    let dest = to_parent.join(&folder_name);
    if dest.exists() {
        return Err(format!("目标位置已存在同名文件夹：{}", dest.to_string_lossy()));
    }
    if dest == from {
        return Err("目标位置与原位置相同".to_string());
    }

    copy_dir_all(&from, &dest).map_err(|e| format!("复制档案失败：{}", e))?;

    // 头像 / 音频 / 视频都以"工作区绝对路径"记录在 project.json 中，迁移后必须重写前缀
    let dest_str = dest.to_string_lossy().into_owned();
    let project_json_path = dest.join("project.json");
    if project_json_path.exists() {
        let content = fs::read_to_string(&project_json_path)
            .map_err(|e| format!("读取新位置 project.json 失败：{}", e))?;

        let rewritten = match serde_json::from_str::<serde_json::Value>(&content) {
            Ok(mut value) => {
                rewrite_path_prefix(&mut value, &from_workspace, &dest_str);
                serde_json::to_string_pretty(&value)
                    .map_err(|e| format!("序列化 project.json 失败：{}", e))?
            }
            // 极端情况下解析失败，退化为纯文本替换
            Err(_) => content.replace(&from_workspace, &dest_str),
        };

        fs::write(&project_json_path, rewritten)
            .map_err(|e| format!("写入新位置 project.json 失败：{}", e))?;
    }

    Ok(dest_str)
}

fn copy_dir_recursive(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let target = dst.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir_recursive(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

/// 读取 project.json 中的 meta.updatedAt 字段（用于比对版本）
fn get_project_updated_at(path: &std::path::Path) -> Option<String> {
    let content = fs::read_to_string(path).ok()?;
    let val: serde_json::Value = serde_json::from_str(&content).ok()?;
    val.get("meta")?.get("updatedAt")?.as_str().map(|s| s.to_string())
}

/// 把随安装包发布的示例家谱释放到应用数据目录（可读写）。
/// 如果目标已存在，但安装包中的示例家谱更新（updatedAt 不同）或 force 为 true，则自动覆盖更新。
#[tauri::command]
fn install_sample_workspace(app: tauri::AppHandle, force: Option<bool>) -> Result<String, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("无法定位资源目录: {}", e))?;
    let src = resource_dir.join("sample-family");
    let src_project = src.join("project.json");
    if !src_project.is_file() {
        return Err("安装包中未找到示例家谱".to_string());
    }
    let dest = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法定位应用数据目录: {}", e))?
        .join("samples")
        .join("以苒纪示例家谱");
    let dest_project = dest.join("project.json");

    let should_copy = if force.unwrap_or(false) || !dest_project.is_file() {
        true
    } else {
        let src_updated = get_project_updated_at(&src_project);
        let dest_updated = get_project_updated_at(&dest_project);
        src_updated.is_some() && src_updated != dest_updated
    };

    if should_copy {
        if dest.exists() {
            let _ = fs::remove_dir_all(&dest);
        }
        copy_dir_recursive(&src, &dest).map_err(|e| format!("释放示例家谱失败: {}", e))?;
    }
    Ok(dest.to_string_lossy().replace('\\', "/"))
}

#[tauri::command]
fn create_project_workspace(parent_dir: String, folder_name: String) -> Result<String, String> {
    let workspace_path = format!("{}/{}", parent_dir, folder_name);
    let media_path = format!("{}/media", workspace_path);
    
    fs::create_dir_all(&media_path)
        .map_err(|e| format!("创建工作区失败: {}", e))?;
        
    Ok(workspace_path)
}

/// 创建导入用的工作区目录：若同名目录已存在则自动追加 (2)、(3)…，避免覆盖已有档案
#[tauri::command]
fn create_unique_project_workspace(parent_dir: String, base_name: String) -> Result<String, String> {
    let parent = PathBuf::from(&parent_dir);
    if !parent.is_dir() {
        return Err(format!("目标目录不存在：{}", parent_dir));
    }

    let base = base_name.trim();
    let base = if base.is_empty() { "以苒纪家谱" } else { base };

    let mut candidate = format!("{}/{}", parent_dir, base);
    let mut index = 2;
    while PathBuf::from(&candidate).exists() {
        candidate = format!("{}/{}({})", parent_dir, base, index);
        index += 1;
        if index > 999 {
            return Err("同名档案过多，请换一个保存位置".to_string());
        }
    }

    let media_path = format!("{}/media", candidate);
    fs::create_dir_all(&media_path)
        .map_err(|e| format!("创建工作区失败: {}", e))?;

    Ok(candidate)
}

#[tauri::command]
fn save_project_json(workspace_path: String, json_content: String) -> Result<(), String> {
    let file_path = format!("{}/project.json", workspace_path);
    fs::write(&file_path, json_content)
        .map_err(|e| format!("保存 project.json 失败: {}", e))?;
    Ok(())
}

/// 数据迁移前备份：把 project.json 复制为同目录下的 project.bak-{label}.json
/// 同名文件已存在时自动追加序号，返回备份文件的绝对路径
#[tauri::command]
fn backup_project_json(workspace_path: String, label: String) -> Result<String, String> {
    let dir = PathBuf::from(&workspace_path);
    let source = dir.join("project.json");
    if !source.is_file() {
        return Err(format!("工作区里没有 project.json：{}", source.to_string_lossy()));
    }

    // 版本号只保留字母数字 . - _，避免出现奇怪的路径字符
    let safe_label: String = label
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '.' || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect();
    let label = if safe_label.is_empty() { "old".to_string() } else { safe_label };

    let mut destination = dir.join(format!("project.bak-{}.json", label));
    let mut counter = 2;
    while destination.exists() {
        destination = dir.join(format!("project.bak-{}-{}.json", label, counter));
        counter += 1;
        if counter > 999 {
            return Err("同名备份文件过多，请先清理 project.bak-*.json".to_string());
        }
    }

    fs::copy(&source, &destination).map_err(|e| format!("备份 project.json 失败: {}", e))?;
    Ok(destination.to_string_lossy().into_owned())
}

/// 判断一个 json 文件是否像以苒纪工程数据（只读前 256KB，避免加载超大文件）
fn looks_like_project(path: &std::path::Path) -> bool {
    let file = match fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return false,
    };

    // 注意：不能直接用 read_to_string，截断点可能落在多字节汉字中间导致解码失败误判
    let mut head_bytes = Vec::new();
    let mut limited = file.take(256 * 1024);
    if limited.read_to_end(&mut head_bytes).is_err() {
        return false;
    }

    let head = String::from_utf8_lossy(&head_bytes);
    head.contains("\"persons\"") && head.contains("\"meta\"")
}

/// 查找"该目录直接包含"的工程数据文件：
/// 1) 优先标准名 project.json
/// 2) 其次任意内容像工程的 .json（用户导出的文件常叫「王氏族谱.json」）
fn direct_project_file(dir: &std::path::Path) -> Option<PathBuf> {
    let standard = dir.join("project.json");
    if standard.is_file() {
        return Some(standard);
    }

    let mut json_candidates: Vec<PathBuf> = Vec::new();
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file()
                && path
                    .extension()
                    .map(|e| e.eq_ignore_ascii_case("json"))
                    .unwrap_or(false)
            {
                json_candidates.push(path);
            }
        }
    }

    // 文件名排序后取第一个匹配，保证结果稳定
    json_candidates.sort();
    json_candidates
        .into_iter()
        .find(|candidate| looks_like_project(candidate))
}

/// 查找工程数据文件：自身没有时，若唯一子目录里有则下钻一层
fn find_project_json(dir: &std::path::Path) -> Option<PathBuf> {
    if let Some(found) = direct_project_file(dir) {
        return Some(found);
    }

    let mut subs_with_project: Vec<PathBuf> = Vec::new();
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let sub = entry.path();
            if sub.is_dir() && direct_project_file(&sub).is_some() {
                subs_with_project.push(sub);
            }
        }
    }

    if subs_with_project.len() == 1 {
        return direct_project_file(&subs_with_project[0]);
    }

    None
}

/// 把用户选中的路径规范化成"工程工作区目录"：
/// - 选的是文件夹且自身有工程 → 原样返回
/// - 选的是文件夹但工程在唯一子目录里 → 返回该子目录
/// - 选的是 .json 文件 → 返回其所在目录
#[tauri::command]
fn resolve_workspace_dir(path: String) -> Result<String, String> {
    let p = PathBuf::from(&path);

    if p.is_file() {
        return p
            .parent()
            .map(|parent| parent.to_string_lossy().into_owned())
            .ok_or_else(|| "无法确定文件所在目录".to_string());
    }

    if !p.is_dir() {
        return Err(format!("路径不存在：{}", path));
    }

    // 自身直接包含工程数据 → 就是它
    if direct_project_file(&p).is_some() {
        return Ok(path);
    }

    // 自身没有，看看是否只有一个子档案（用户可能选了上一级目录）
    let mut subs: Vec<PathBuf> = Vec::new();
    if let Ok(entries) = fs::read_dir(&p) {
        for entry in entries.flatten() {
            let sub = entry.path();
            if sub.is_dir() && direct_project_file(&sub).is_some() {
                subs.push(sub);
            }
        }
    }

    match subs.len() {
        1 => Ok(subs[0].to_string_lossy().into_owned()),
        0 => Err("这个文件夹里没有找到以苒纪工程数据（project.json 或导出的 .json）".to_string()),
        _ => Err("该文件夹下有多个家谱档案，请直接选择其中一个子文件夹".to_string()),
    }
}

#[tauri::command]
fn load_project_json(workspace_path: String) -> Result<String, String> {
    let dir = PathBuf::from(&workspace_path);
    let file_path = find_project_json(&dir).ok_or_else(|| {
        format!(
            "在 {} 中未找到工程数据（需要 project.json 或包含 meta/persons 的 .json）",
            workspace_path
        )
    })?;

    fs::read_to_string(&file_path)
        .map_err(|e| format!("读取工程数据失败: {}（{}）", e, file_path.to_string_lossy()))
}

#[tauri::command]
fn save_media_file(workspace_path: String, filename: String, base64_data: String) -> Result<(), String> {
    use base64::{Engine as _, engine::general_purpose};
    
    let clean_base64 = if base64_data.contains(",") {
        base64_data.split(',').collect::<Vec<&str>>()[1]
    } else {
        &base64_data
    };
    
    let binary_data = general_purpose::STANDARD
        .decode(clean_base64)
        .map_err(|e| format!("解码 Base64 失败: {}", e))?;
        
    let media_dir = format!("{}/media", workspace_path);
    fs::create_dir_all(&media_dir)
        .map_err(|e| format!("创建 media 文件夹失败: {}", e))?;

    // 拼装目标文件绝对路径，并自动递归创建其所在的子目录
    let target_path = PathBuf::from(&media_dir).join(&filename);
    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("创建媒体子文件夹失败: {}", e))?;
    }

    fs::write(&target_path, binary_data)
        .map_err(|e| format!("写入媒体文件失败: {}", e))?;
        
    Ok(())
}

#[tauri::command]
fn delete_media_file(workspace_path: String, media_path: String) -> Result<(), String> {
    let media_dir = PathBuf::from(&workspace_path).join("media");
    fs::create_dir_all(&media_dir)
        .map_err(|e| format!("创建 media 文件夹失败: {}", e))?;

    let media_dir = media_dir
        .canonicalize()
        .map_err(|e| format!("解析 media 文件夹失败: {}", e))?;

    let file_path = PathBuf::from(&media_path);

    if !file_path.exists() {
        return Ok(());
    }

    let file_path = file_path
        .canonicalize()
        .map_err(|e| format!("解析媒体文件路径失败: {}", e))?;

    if !file_path.starts_with(&media_dir) {
        return Err("只能删除当前工作区 media 目录下的文件".to_string());
    }

    fs::remove_file(&file_path)
        .map_err(|e| format!("删除媒体文件失败: {}", e))?;

    // 智能清理：以 "avatar_" 开头的专属头像子目录，在其中文件被删光后顺带移除空目录。
    // 目录里可能还留有「头像原图」（登记在照片栏中），所以不能整目录删除。
    if let Some(parent) = file_path.parent() {
        if let Some(dir_name) = parent.file_name().and_then(|n| n.to_str()) {
            if dir_name.starts_with("avatar_") {
                let is_empty = fs::read_dir(parent)
                    .map(|mut it| it.next().is_none())
                    .unwrap_or(false);
                if is_empty {
                    let _ = fs::remove_dir(parent);
                }
            }
        }
    }
    Ok(())
}

/// 批量检查媒体文件是否存在（用于旧数据迁移时判断头像原图文件是否还在）
#[tauri::command]
fn check_media_files_exist(paths: Vec<String>) -> Vec<bool> {
    paths.iter().map(|p| PathBuf::from(p).is_file()).collect()
}

#[tauri::command]
fn pack_to_yrj(workspace_path: String, dest_yrj_path: String, password: Option<String>) -> Result<(), String> {
    let data = yrj_file::serialize_yrj_workspace(&workspace_path, password)?;
    fs::write(&dest_yrj_path, data)
        .map_err(|e| format!("打包写入 YRJ 失败: {}", e))?;
    Ok(())
}

#[tauri::command]
fn unpack_yrj(yrj_path: String, parent_dir: String, folder_name: String, password: Option<String>) -> Result<String, String> {
    let mut final_folder_name = folder_name.clone();
    let mut workspace_path = format!("{}/{}", parent_dir, final_folder_name);
    
    // 如果目标工作区目录已存在，则自动添加自增后缀以保护用户已有数据不被覆盖
    if std::path::Path::new(&workspace_path).exists() {
        let mut index = 1;
        while std::path::Path::new(&format!("{}/{}_{}", parent_dir, folder_name, index)).exists() {
            index += 1;
        }
        final_folder_name = format!("{}_{}", folder_name, index);
        workspace_path = format!("{}/{}", parent_dir, final_folder_name);
    }

    let data = fs::read(&yrj_path)
        .map_err(|e| format!("读取 YRJ 文件失败: {}", e))?;
        
    yrj_file::deserialize_yrj_workspace(&data, &workspace_path, password)?;
    Ok(workspace_path)
}

#[tauri::command]
fn is_yrj_file_encrypted(path: String) -> Result<bool, String> {
    let mut file = fs::File::open(&path).map_err(|e| format!("打开文件失败: {}", e))?;
    let mut header = [0u8; 13];
    file.read_exact(&mut header).map_err(|e| format!("读取文件头失败: {}", e))?;

    if &header[0..8] != b"YIRANJI\0" {
        return Err("无效的以苒纪工程文件格式".to_string());
    }

    let flags = header[12];
    Ok((flags & 1) != 0)
}

#[tauri::command]
fn open_devtools(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        window.open_devtools();
    }
}

#[tauri::command]
fn write_binary_file(path: String, base64_data: String) -> Result<(), String> {
    use base64::{Engine as _, engine::general_purpose};

    let clean_base64 = if base64_data.contains(",") {
        base64_data.split(',').collect::<Vec<&str>>()[1]
    } else {
        &base64_data
    };

    let binary_data = general_purpose::STANDARD
        .decode(clean_base64)
        .map_err(|e| format!("解码 Base64 失败: {}", e))?;

    // 确保父目录存在
    if let Some(parent) = std::path::Path::new(&path).parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("创建父目录失败: {}", e))?;
    }

    fs::write(&path, binary_data)
        .map_err(|e| format!("写入文件失败: {}", e))?;
    Ok(())
}

#[tauri::command]
fn get_app_logs(app: tauri::AppHandle) -> Result<Vec<(String, String)>, String> {
    if let Ok(log_dir) = app.path().app_log_dir() {
        if log_dir.exists() {
            let mut logs = Vec::new();
            match fs::read_dir(&log_dir) {
                Ok(entries) => {
                    for entry in entries {
                        if let Ok(entry) = entry {
                            let path = entry.path();
                            if path.is_file() {
                                if let Ok(content) = fs::read_to_string(&path) {
                                    logs.push((
                                        path.file_name()
                                            .unwrap_or_default()
                                            .to_string_lossy()
                                            .into_owned(),
                                        content,
                                    ));
                                }
                            }
                        }
                    }
                }
                Err(_) => {}
            }
            if !logs.is_empty() {
                return Ok(logs);
            }
        }
    }
    Ok(Vec::new())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // 在启动后延时 200ms（等待 Webview 初始化和静态资源开始解析）由 Rust 强行唤醒主窗口
            // 既能消灭冷启动白屏，又能作为万能兜底，防止前端加载异常或热重载时黑屏死锁
            if let Some(main_window) = app.get_webview_window("main") {
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(200));
                    let _ = main_window.maximize();
                    let _ = main_window.show();
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            select_yrj_file_path_for_save,
            select_zip_file_path_for_save,
            select_export_file_path,
            select_yrj_file_path_for_open,
            select_project_parent_dir,
            open_in_explorer,
            move_project_workspace,
            create_project_workspace,
            create_unique_project_workspace,
            install_sample_workspace,
            check_media_files_exist,
            resolve_workspace_dir,
            save_project_json,
            backup_project_json,
            load_project_json,
            save_media_file,
            delete_media_file,
            pack_to_yrj,
            unpack_yrj,
            is_yrj_file_encrypted,
            open_devtools,
            write_binary_file,
            get_app_logs,
            webdav::webdav_test,
            webdav::webdav_remote_meta,
            webdav::webdav_list_projects,
            webdav::webdav_push,
            webdav::webdav_pull
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
