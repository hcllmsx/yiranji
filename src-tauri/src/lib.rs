mod associated_files;
pub mod project_file;
pub mod settings;
pub mod webdav;
mod yrj_file;

use sha2::{Digest, Sha256};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use tauri::Manager;

#[tauri::command(async)]
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
fn select_export_file_path(
    default_name: String,
    filter_name: String,
    extensions: Vec<String>,
) -> Result<Option<String>, String> {
    let file = rfd::FileDialog::new()
        .add_filter(&filter_name, &extensions)
        .set_file_name(&default_name)
        .save_file();

    Ok(file.map(|p| p.to_string_lossy().into_owned()))
}

#[tauri::command]
fn select_yrj_file_path_for_open() -> Result<Option<String>, String> {
    let file = rfd::FileDialog::new()
        .add_filter("以苒纪工程与文件包 (*.yrp;*.yrj)", &["yrp", "yrj"])
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
        std::process::Command::new("explorer")
            .arg(arg)
            .spawn()
            .map(|_| ())
    };

    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open")
        .arg(&path)
        .spawn()
        .map(|_| ());

    #[cfg(all(unix, not(target_os = "macos")))]
    let result = std::process::Command::new("xdg-open")
        .arg(&path)
        .spawn()
        .map(|_| ());

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
            items
                .iter_mut()
                .for_each(|item| rewrite_path_prefix(item, from, to));
        }
        serde_json::Value::Object(map) => {
            map.values_mut()
                .for_each(|v| rewrite_path_prefix(v, from, to));
        }
        _ => {}
    }
}

/// 将整个档案工作区复制到新的父目录下，并修正 YRP 内的绝对媒体路径。
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
        return Err(format!(
            "目标位置已存在同名文件夹：{}",
            dest.to_string_lossy()
        ));
    }
    if dest == from {
        return Err("目标位置与原位置相同".to_string());
    }

    copy_dir_all(&from, &dest).map_err(|e| format!("复制档案失败：{}", e))?;

    let dest_str = dest.to_string_lossy().into_owned();
    if let Some(project_path) = direct_project_file(&dest) {
        let content = project_file::read_project(&project_path)?;
        let mut value = serde_json::from_str::<serde_json::Value>(&content)
            .map_err(|e| format!("解析新位置工程数据失败：{}", e))?;
        rewrite_path_prefix(&mut value, &from_workspace, &dest_str);
        let rewritten = serde_json::to_string_pretty(&value)
            .map_err(|e| format!("序列化工程数据失败：{}", e))?;
        project_file::write_workspace_project(&dest, &rewritten)?;
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

/// 读取工程文件中的 meta.updatedAt 字段（用于比对示例版本）。
fn get_project_updated_at(path: &Path) -> Option<String> {
    let content = project_file::read_project(path).ok()?;
    let val: serde_json::Value = serde_json::from_str(&content).ok()?;
    val.get("meta")?
        .get("updatedAt")?
        .as_str()
        .map(|s| s.to_string())
}

/// 把随安装包发布的示例家谱释放到应用数据目录（可读写）。
/// 如果目标已存在，但安装包中的示例家谱更新（updatedAt 不同）或 force 为 true，则自动覆盖更新。
#[tauri::command(async)]
fn install_sample_workspace(app: tauri::AppHandle, force: Option<bool>) -> Result<String, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("无法定位资源目录: {}", e))?;
    // 开发调试模式下优先直接读取源码资源目录，避免受 target/debug 增量构建缓存残留干扰
    let src = if cfg!(debug_assertions) {
        let candidate_paths = [
            PathBuf::from("resources/sample-family"),
            PathBuf::from("src-tauri/resources/sample-family"),
            PathBuf::from("../src-tauri/resources/sample-family"),
        ];
        candidate_paths
            .into_iter()
            .find(|p| p.join(project_file::PROJECT_FILE_NAME).is_file())
            .unwrap_or_else(|| resource_dir.join("sample-family"))
    } else {
        resource_dir.join("sample-family")
    };
    let src_project = src.join(project_file::PROJECT_FILE_NAME);
    if !src_project.is_file() {
        return Err("安装包中未找到示例家谱".to_string());
    }
    let dest = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法定位应用数据目录: {}", e))?
        .join("samples")
        .join("示例家谱");
    let dest_project = dest.join(project_file::PROJECT_FILE_NAME);

    let should_copy = if force.unwrap_or(false) || !dest_project.is_file() || cfg!(debug_assertions)
    {
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
    Ok(dest.to_string_lossy().into_owned())
}

#[tauri::command]
fn create_project_workspace(parent_dir: String, folder_name: String) -> Result<String, String> {
    let workspace_path = format!("{}/{}", parent_dir, folder_name);
    let media_path = format!("{}/media", workspace_path);

    fs::create_dir_all(&media_path).map_err(|e| format!("创建工作区失败: {}", e))?;

    Ok(workspace_path)
}

/// 创建导入用的工作区目录：若同名目录已存在则自动追加 (2)、(3)…，避免覆盖已有档案
#[tauri::command]
fn create_unique_project_workspace(
    parent_dir: String,
    base_name: String,
) -> Result<String, String> {
    let parent = PathBuf::from(&parent_dir);
    if !parent.is_dir() {
        return Err(format!("目标目录不存在：{}", parent_dir));
    }

    let base = base_name.trim();
    let base = if base.is_empty() {
        "以苒纪家谱"
    } else {
        base
    };

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
    fs::create_dir_all(&media_path).map_err(|e| format!("创建工作区失败: {}", e))?;

    Ok(candidate)
}

#[tauri::command(async)]
fn save_project_file(workspace_path: String, json_content: String) -> Result<(), String> {
    project_file::write_workspace_project(Path::new(&workspace_path), &json_content)?;
    Ok(())
}

/// 数据关系迁移前，在工作区保留一份 YRP 快照。
#[tauri::command(async)]
fn backup_project_file(workspace_path: String, label: String) -> Result<String, String> {
    let dir = PathBuf::from(&workspace_path);
    let source = dir.join(project_file::PROJECT_FILE_NAME);
    if !source.is_file() {
        return Err(format!(
            "工作区里没有 project.yrp：{}",
            source.to_string_lossy()
        ));
    }

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
    let label = if safe_label.is_empty() {
        "old".to_string()
    } else {
        safe_label
    };

    let mut destination = dir.join(format!("project.bak-{}.yrp", label));
    let mut counter = 2;
    while destination.exists() {
        destination = dir.join(format!("project.bak-{}-{}.yrp", label, counter));
        counter += 1;
        if counter > 999 {
            return Err("同名备份文件过多，请先清理 project.bak-*.yrp".to_string());
        }
    }

    fs::copy(&source, &destination).map_err(|e| format!("备份 project.yrp 失败：{}", e))?;
    Ok(destination.to_string_lossy().into_owned())
}

fn looks_like_project(path: &Path) -> bool {
    let file = match fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return false,
    };
    let mut head_bytes = Vec::new();
    let mut limited = file.take(256 * 1024);
    if limited.read_to_end(&mut head_bytes).is_err() {
        return false;
    }
    let head = String::from_utf8_lossy(&head_bytes);
    head.contains("\"persons\"") && head.contains("\"meta\"")
}

/// 工作区标准文件优先；任意 JSON 仅作为旧版网页导出数据的兼容入口。
fn direct_project_file(dir: &Path) -> Option<PathBuf> {
    let standard = dir.join(project_file::PROJECT_FILE_NAME);
    if standard.is_file() {
        return Some(standard);
    }
    let legacy = dir.join(project_file::LEGACY_PROJECT_FILE_NAME);
    if legacy.is_file() {
        return Some(legacy);
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
    json_candidates.sort();
    json_candidates
        .into_iter()
        .find(|candidate| looks_like_project(candidate))
}

fn find_project_file(dir: &Path) -> Option<PathBuf> {
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

#[tauri::command(async)]
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
    if direct_project_file(&p).is_some() {
        return Ok(path);
    }

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
        0 => Err(
            "这个文件夹里没有找到以苒纪工程数据（project.yrp、旧版 project.json 或导出的 .json）"
                .to_string(),
        ),
        _ => Err("该文件夹下有多个家谱档案，请直接选择其中一个子文件夹".to_string()),
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct LoadProjectResult {
    json: String,
    format_backup_path: Option<String>,
}

fn safe_backup_name(value: &str) -> String {
    let cleaned: String = value
        .chars()
        .map(|ch| {
            if "<>/\\:*?\"|".contains(ch) || ch.is_control() {
                '_'
            } else {
                ch
            }
        })
        .take(60)
        .collect();
    let cleaned = cleaned.trim().trim_matches('.');
    if cleaned.is_empty() {
        "未命名家谱".to_string()
    } else {
        cleaned.to_string()
    }
}

fn migration_timestamp() -> String {
    let format = time::format_description::parse("[year][month][day]-[hour][minute][second]")
        .expect("valid time format");
    time::OffsetDateTime::now_utc()
        .format(&format)
        .unwrap_or_else(|_| "unknown-time".to_string())
}

/// 将旧版标准 project.json 转为 YRP。原始 JSON 先备份，YRP 回读成功后才删除旧文件。
fn migrate_legacy_project(
    app: &tauri::AppHandle,
    workspace: &Path,
    source: &Path,
) -> Result<LoadProjectResult, String> {
    let backup_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("无法定位缓存备份目录：{}", e))?
        .join("backups");
    migrate_legacy_project_with_backup(workspace, source, &backup_dir)
}

fn migrate_legacy_project_with_backup(
    workspace: &Path,
    source: &Path,
    backup_dir: &Path,
) -> Result<LoadProjectResult, String> {
    let raw = fs::read(source).map_err(|e| format!("读取旧版工程失败：{}", e))?;
    let original: serde_json::Value =
        serde_json::from_slice(&raw).map_err(|e| format!("旧版 project.json 无法解析：{}", e))?;
    if original.get("meta").is_none() || original.get("persons").is_none() {
        return Err("旧版 project.json 缺少 meta 或 persons，未执行格式转换".to_string());
    }
    let json = String::from_utf8(raw.clone()).map_err(|_| "旧版工程不是有效 UTF-8".to_string())?;
    let family_name = original
        .get("meta")
        .and_then(|meta| meta.get("familyName"))
        .and_then(|name| name.as_str())
        .or_else(|| workspace.file_name().and_then(|name| name.to_str()))
        .unwrap_or("未命名家谱");

    fs::create_dir_all(backup_dir).map_err(|e| format!("创建缓存备份目录失败：{}", e))?;
    let stem = format!(
        "project-{}-{}",
        safe_backup_name(family_name),
        migration_timestamp()
    );
    let mut backup_path = backup_dir.join(format!("{}.json", stem));
    let mut counter = 2;
    while backup_path.exists() {
        backup_path = backup_dir.join(format!("{}-{}.json", stem, counter));
        counter += 1;
    }
    fs::copy(source, &backup_path).map_err(|e| format!("备份旧版 JSON 失败：{}", e))?;
    if fs::read(&backup_path).map_err(|e| format!("校验旧版备份失败：{}", e))? != raw {
        return Err("旧版 JSON 备份校验失败，未修改原工程".to_string());
    }

    let destination = workspace.join(project_file::PROJECT_FILE_NAME);
    project_file::write_project(&destination, &json)?;
    let verified_raw = project_file::read_project(&destination)?;
    let verified: serde_json::Value =
        serde_json::from_str(&verified_raw).map_err(|e| format!("回读新 YRP 失败：{}", e))?;
    if verified != original {
        return Err("新 YRP 数据校验不一致，旧版 JSON 仍保留在工作区".to_string());
    }
    fs::remove_file(source).map_err(|e| {
        format!(
            "YRP 已生成且原始 JSON 已备份，但移除旧 project.json 失败：{}",
            e
        )
    })?;

    Ok(LoadProjectResult {
        json,
        format_backup_path: Some(backup_path.to_string_lossy().into_owned()),
    })
}

#[tauri::command(async)]
fn load_project_file(
    app: tauri::AppHandle,
    workspace_path: String,
) -> Result<LoadProjectResult, String> {
    let dir = PathBuf::from(&workspace_path);
    let file_path = find_project_file(&dir)
        .ok_or_else(|| format!("在 {} 中未找到以苒纪工程数据", workspace_path))?;

    if file_path.file_name().and_then(|name| name.to_str())
        == Some(project_file::LEGACY_PROJECT_FILE_NAME)
    {
        return migrate_legacy_project(&app, &dir, &file_path);
    }

    Ok(LoadProjectResult {
        json: project_file::read_project(&file_path)?,
        format_backup_path: None,
    })
}

#[tauri::command]
fn save_media_file(
    workspace_path: String,
    filename: String,
    base64_data: String,
) -> Result<(), String> {
    use base64::{engine::general_purpose, Engine as _};

    let clean_base64 = if base64_data.contains(",") {
        base64_data.split(',').collect::<Vec<&str>>()[1]
    } else {
        &base64_data
    };

    let binary_data = general_purpose::STANDARD
        .decode(clean_base64)
        .map_err(|e| format!("解码 Base64 失败: {}", e))?;

    let media_dir = format!("{}/media", workspace_path);
    fs::create_dir_all(&media_dir).map_err(|e| format!("创建 media 文件夹失败: {}", e))?;

    // 拼装目标文件绝对路径，并自动递归创建其所在的子目录
    let target_path = PathBuf::from(&media_dir).join(&filename);
    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建媒体子文件夹失败: {}", e))?;
    }

    fs::write(&target_path, binary_data).map_err(|e| format!("写入媒体文件失败: {}", e))?;

    Ok(())
}

#[tauri::command]
fn delete_media_file(workspace_path: String, media_path: String) -> Result<(), String> {
    let media_dir = PathBuf::from(&workspace_path).join("media");
    fs::create_dir_all(&media_dir).map_err(|e| format!("创建 media 文件夹失败: {}", e))?;

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

    fs::remove_file(&file_path).map_err(|e| format!("删除媒体文件失败: {}", e))?;

    Ok(())
}

/// 从磁盘永久删除家谱工作区目录或 .yrj 文件
#[tauri::command]
fn delete_project_workspace_from_disk(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        // 若在外部已被删除，直接返回成功，方便前端清理历史记录
        return Ok(());
    }

    // 安全检查：禁止删除根路径或系统关键目录
    if let Some(parent) = p.parent() {
        if parent.as_os_str().is_empty() && p.is_dir() {
            return Err("安全限制：禁止删除磁盘根目录".to_string());
        }
    } else {
        return Err("安全限制：无效路径".to_string());
    }

    let norm_path = path.replace('\\', "/");
    let trimmed = norm_path.trim_end_matches('/');
    if trimmed.len() <= 3 && trimmed.ends_with(':') {
        return Err("安全限制：禁止删除磁盘驱动器".to_string());
    }

    if p.is_dir() {
        fs::remove_dir_all(&p).map_err(|e| format!("从磁盘删除家谱文件夹失败: {}", e))?;
    } else if p.is_file() {
        fs::remove_file(&p).map_err(|e| format!("从磁盘删除文件失败: {}", e))?;
    }

    Ok(())
}

#[tauri::command(async)]
fn pack_to_yrj(
    workspace_path: String,
    dest_yrj_path: String,
    password: Option<String>,
) -> Result<(), String> {
    let data = yrj_file::serialize_yrj_workspace(&workspace_path, password)?;
    fs::write(&dest_yrj_path, data).map_err(|e| format!("打包写入 YRJ 失败: {}", e))?;
    Ok(())
}

const IMPORT_SOURCE_MARKER_FILE: &str = ".yrj-source.json";

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportSourceMarker {
    source_path: String,
    sha256: String,
}

fn import_source_matches(dir: &Path, source_path: &Path, sha256: &str) -> bool {
    if direct_project_file(dir).is_none() {
        return false;
    }
    let Ok(raw) = fs::read(dir.join(IMPORT_SOURCE_MARKER_FILE)) else {
        return false;
    };
    let Ok(marker) = serde_json::from_slice::<ImportSourceMarker>(&raw) else {
        return false;
    };
    marker.source_path == source_path.to_string_lossy() && marker.sha256 == sha256
}

fn create_import_staging_dir(workspace: &Path) -> Result<PathBuf, String> {
    let parent = workspace
        .parent()
        .ok_or_else(|| "无法确定导入临时目录的父目录".to_string())?;
    fs::create_dir_all(parent).map_err(|e| format!("创建导入临时目录失败：{}", e))?;
    let folder_name = workspace
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("workspace");

    for nonce in 0u32.. {
        let candidate = parent.join(format!(
            ".{}.import-{}-{}",
            folder_name,
            std::process::id(),
            nonce
        ));
        match fs::create_dir(&candidate) {
            Ok(()) => return Ok(candidate),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(format!("创建导入临时目录失败：{}", e)),
        }
    }
    unreachable!()
}

#[tauri::command(async)]
fn unpack_yrj(
    yrj_path: String,
    parent_dir: String,
    folder_name: String,
    password: Option<String>,
) -> Result<String, String> {
    let source_path =
        fs::canonicalize(&yrj_path).map_err(|e| format!("解析 YRJ 路径失败：{}", e))?;
    let data = fs::read(&source_path).map_err(|e| format!("读取 YRJ 文件失败: {}", e))?;
    let source_hash = format!("{:x}", Sha256::digest(&data));
    let marker = serde_json::to_vec(&ImportSourceMarker {
        source_path: source_path.to_string_lossy().into_owned(),
        sha256: source_hash.clone(),
    })
    .map_err(|e| format!("序列化导入来源标记失败：{}", e))?;

    let mut index = 0u32;
    let workspace_path = loop {
        let candidate_name = if index == 0 {
            folder_name.clone()
        } else {
            format!("{}_{}", folder_name, index)
        };
        let candidate = PathBuf::from(&parent_dir).join(candidate_name);
        if import_source_matches(&candidate, &source_path, &source_hash) {
            return Ok(candidate.to_string_lossy().into_owned());
        }
        if !candidate.exists() {
            break candidate;
        }
        index += 1;
    };

    let staging_path = create_import_staging_dir(&workspace_path)?;
    let result = (|| {
        yrj_file::deserialize_yrj_workspace(&data, &staging_path.to_string_lossy(), password)?;
        fs::write(staging_path.join(IMPORT_SOURCE_MARKER_FILE), marker)
            .map_err(|e| format!("写入导入来源标记失败：{}", e))?;
        fs::rename(&staging_path, &workspace_path).map_err(|e| format!("提交导入工作区失败：{}", e))
    })();
    if let Err(error) = result {
        let _ = fs::remove_dir_all(&staging_path);
        return Err(error);
    }

    Ok(workspace_path.to_string_lossy().into_owned())
}

#[tauri::command]
fn is_yrj_file_encrypted(path: String) -> Result<bool, String> {
    let mut file = fs::File::open(&path).map_err(|e| format!("打开文件失败: {}", e))?;
    let mut header = [0u8; 13];
    file.read_exact(&mut header)
        .map_err(|e| format!("读取文件头失败: {}", e))?;

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
    use base64::{engine::general_purpose, Engine as _};

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
        fs::create_dir_all(parent).map_err(|e| format!("创建父目录失败: {}", e))?;
    }

    fs::write(&path, binary_data).map_err(|e| format!("写入文件失败: {}", e))?;
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

#[derive(serde::Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FolderStats {
    pub total_bytes: u64,
    pub file_count: usize,
    pub dir_count: usize,
}

#[tauri::command]
fn get_workspace_stats(workspace_path: String) -> Result<FolderStats, String> {
    let p = std::path::Path::new(&workspace_path);
    if !p.is_dir() {
        return Ok(FolderStats::default());
    }
    let mut total_bytes = 0u64;
    let mut file_count = 0usize;
    let mut dir_count = 0usize;

    let mut stack = vec![p.to_path_buf()];
    while let Some(current) = stack.pop() {
        let entries = match fs::read_dir(&current) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                dir_count += 1;
                stack.push(path);
            } else if let Ok(meta) = entry.metadata() {
                file_count += 1;
                total_bytes += meta.len();
            }
        }
    }

    Ok(FolderStats {
        total_bytes,
        file_count,
        dir_count,
    })
}

#[tauri::command]
async fn webdav_push(
    app: tauri::AppHandle,
    server: String,
    username: String,
    password: String,
    remote_dir: String,
    workspace_path: String,
    device: Option<String>,
) -> Result<webdav::PushReport, String> {
    use tauri::Emitter;
    webdav::webdav_push_with_progress(
        server,
        username,
        password,
        remote_dir,
        workspace_path,
        device,
        |progress| {
            let _ = app.emit("webdav-push-progress", &progress);
        },
    )
    .await
}

#[tauri::command]
async fn webdav_pull(
    app: tauri::AppHandle,
    server: String,
    username: String,
    password: String,
    remote_dir: String,
    workspace_path: String,
) -> Result<webdav::PullReport, String> {
    use tauri::Emitter;
    webdav::webdav_pull_with_progress(
        server,
        username,
        password,
        remote_dir,
        workspace_path,
        |progress| {
            let _ = app.emit("webdav-pull-progress", &progress);
        },
    )
    .await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let initial_paths = associated_files::paths_from_args(std::env::args());
    tauri::Builder::default()
        .manage(associated_files::AssociatedFilesState::new(initial_paths))
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            associated_files::dispatch(app, associated_files::paths_from_args(argv));
        }))
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
            resolve_workspace_dir,
            save_project_file,
            backup_project_file,
            load_project_file,
            save_media_file,
            delete_media_file,
            pack_to_yrj,
            unpack_yrj,
            is_yrj_file_encrypted,
            associated_files::take_pending_associated_files,
            associated_files::acknowledge_associated_file,
            open_devtools,
            write_binary_file,
            get_app_logs,
            webdav::webdav_test,
            webdav::webdav_remote_meta,
            webdav::webdav_list_projects,
            webdav_push,
            webdav_pull,
            settings::load_app_settings,
            settings::save_app_settings,
            settings::get_settings_file_path,
            get_workspace_stats,
            delete_project_workspace_from_disk
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_workspace_is_backed_up_and_converted_before_old_file_is_removed() {
        let temp = tempfile::tempdir().unwrap();
        let workspace = temp.path().join("workspace");
        let backups = temp.path().join("cache/backups");
        fs::create_dir_all(&workspace).unwrap();
        let source = workspace.join(project_file::LEGACY_PROJECT_FILE_NAME);
        let json = r#"{"meta":{"familyName":"测试家谱"},"persons":{"p1":{"id":"p1"}}}"#;
        fs::write(&source, json).unwrap();

        let result = migrate_legacy_project_with_backup(&workspace, &source, &backups).unwrap();
        assert_eq!(result.json, json);
        assert!(!source.exists());
        let backup = PathBuf::from(result.format_backup_path.unwrap());
        assert_eq!(fs::read_to_string(backup).unwrap(), json);
        assert_eq!(
            project_file::read_project(&workspace.join(project_file::PROJECT_FILE_NAME)).unwrap(),
            json
        );
    }

    #[test]
    fn invalid_legacy_json_is_not_modified_or_backed_up() {
        let temp = tempfile::tempdir().unwrap();
        let workspace = temp.path().join("workspace");
        let backups = temp.path().join("cache/backups");
        fs::create_dir_all(&workspace).unwrap();
        let source = workspace.join(project_file::LEGACY_PROJECT_FILE_NAME);
        fs::write(&source, "{invalid").unwrap();

        assert!(migrate_legacy_project_with_backup(&workspace, &source, &backups).is_err());
        assert_eq!(fs::read_to_string(&source).unwrap(), "{invalid");
        assert!(!workspace.join(project_file::PROJECT_FILE_NAME).exists());
        assert!(!backups.exists());
    }

    #[test]
    fn repeated_yrj_import_reuses_existing_workspace() {
        let temp = tempfile::tempdir().unwrap();
        let parent = temp.path();
        let workspace = parent.join("家谱");
        let source_workspace = parent.join("source");
        fs::create_dir_all(&source_workspace).unwrap();
        project_file::write_workspace_project(&source_workspace, r#"{"meta":{},"persons":{}}"#)
            .unwrap();
        let yrj_path = parent.join("家谱.yrj");
        let data =
            yrj_file::serialize_yrj_workspace(&source_workspace.to_string_lossy(), None).unwrap();
        fs::write(&yrj_path, &data).unwrap();

        let reopened = unpack_yrj(
            parent.join("家谱.yrj").to_string_lossy().into_owned(),
            parent.to_string_lossy().into_owned(),
            "家谱".into(),
            None,
        )
        .unwrap();
        assert_eq!(PathBuf::from(reopened), workspace);
        let reopened = unpack_yrj(
            yrj_path.to_string_lossy().into_owned(),
            parent.to_string_lossy().into_owned(),
            "家谱".into(),
            None,
        )
        .unwrap();
        assert_eq!(PathBuf::from(reopened), workspace);
        assert!(!parent.join("家谱_1").exists());
        let marker: ImportSourceMarker =
            serde_json::from_slice(&fs::read(workspace.join(IMPORT_SOURCE_MARKER_FILE)).unwrap())
                .unwrap();
        assert_eq!(
            marker.source_path,
            fs::canonicalize(&yrj_path).unwrap().to_string_lossy()
        );
        assert_eq!(marker.sha256, format!("{:x}", Sha256::digest(&data)));
    }

    #[test]
    fn same_name_and_path_with_different_content_uses_unique_workspace() {
        let temp = tempfile::tempdir().unwrap();
        let parent = temp.path();
        let source_workspace = parent.join("source");
        let first_workspace = parent.join("家谱");
        fs::create_dir_all(&source_workspace).unwrap();
        project_file::write_workspace_project(
            &source_workspace,
            r#"{"meta":{"familyName":"第一版"},"persons":{}}"#,
        )
        .unwrap();
        let yrj_path = parent.join("家谱.yrj");
        fs::write(
            &yrj_path,
            yrj_file::serialize_yrj_workspace(&source_workspace.to_string_lossy(), None).unwrap(),
        )
        .unwrap();
        let first = unpack_yrj(
            yrj_path.to_string_lossy().into_owned(),
            parent.to_string_lossy().into_owned(),
            "家谱".into(),
            None,
        )
        .unwrap();
        assert_eq!(PathBuf::from(first), first_workspace);

        project_file::write_workspace_project(
            &source_workspace,
            r#"{"meta":{"familyName":"第二版"},"persons":{}}"#,
        )
        .unwrap();
        fs::write(
            &yrj_path,
            yrj_file::serialize_yrj_workspace(&source_workspace.to_string_lossy(), None).unwrap(),
        )
        .unwrap();
        let second = unpack_yrj(
            yrj_path.to_string_lossy().into_owned(),
            parent.to_string_lossy().into_owned(),
            "家谱".into(),
            None,
        )
        .unwrap();

        assert_eq!(PathBuf::from(second), parent.join("家谱_1"));
        assert!(
            project_file::read_project(&first_workspace.join(project_file::PROJECT_FILE_NAME))
                .unwrap()
                .contains("第一版")
        );
        assert!(project_file::read_project(
            &parent.join("家谱_1").join(project_file::PROJECT_FILE_NAME)
        )
        .unwrap()
        .contains("第二版"));

        let repeated_second = unpack_yrj(
            yrj_path.to_string_lossy().into_owned(),
            parent.to_string_lossy().into_owned(),
            "家谱".into(),
            None,
        )
        .unwrap();
        assert_eq!(PathBuf::from(repeated_second), parent.join("家谱_1"));
        assert!(!parent.join("家谱_2").exists());
    }

    #[test]
    fn failed_unpack_cleans_staging_and_cannot_be_reused() {
        use std::io::{Cursor, Write};
        use zip::write::FileOptions;
        use zip::ZipWriter;

        let temp = tempfile::tempdir().unwrap();
        let parent = temp.path();
        let yrj_path = parent.join("家谱.yrj");
        let workspace = parent.join("家谱");
        let payload = b"broken-media-payload";
        let mut zip_data = Vec::new();
        {
            let mut zip = ZipWriter::new(Cursor::new(&mut zip_data));
            zip.start_file(
                "project.yrp",
                FileOptions::default().compression_method(zip::CompressionMethod::Stored),
            )
            .unwrap();
            zip.write_all(br#"{"meta":{},"persons":{}}"#).unwrap();
            zip.start_file(
                "media/bad.bin",
                FileOptions::default().compression_method(zip::CompressionMethod::Stored),
            )
            .unwrap();
            zip.write_all(payload).unwrap();
            zip.finish().unwrap();
        }
        let payload_offset = zip_data
            .windows(payload.len())
            .position(|window| window == payload)
            .unwrap();
        zip_data[payload_offset] ^= 0xff;
        let mut data = Vec::new();
        data.extend_from_slice(b"YIRANJI\0");
        data.extend_from_slice(&2u32.to_le_bytes());
        data.push(0);
        data.extend_from_slice(&[0u8; 32]);
        data.extend_from_slice(&[0u8; 12]);
        data.extend_from_slice(&zip_data);
        fs::write(&yrj_path, &data).unwrap();

        assert!(unpack_yrj(
            yrj_path.to_string_lossy().into_owned(),
            parent.to_string_lossy().into_owned(),
            "家谱".into(),
            None,
        )
        .is_err());
        assert!(!workspace.exists());
        assert!(fs::read_dir(parent)
            .unwrap()
            .all(|entry| !entry.unwrap().path().is_dir()));
    }
}
