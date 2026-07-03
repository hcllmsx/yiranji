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
fn select_yrj_file_path_for_open() -> Result<Option<String>, String> {
    let file = rfd::FileDialog::new()
        .add_filter("以苒纪工程文件 (*.yrj)", &["yrj"])
        .pick_file();
    
    Ok(file.map(|p| p.to_string_lossy().into_owned()))
}

#[tauri::command]
fn select_project_parent_dir() -> Result<Option<String>, String> {
    let dir = rfd::FileDialog::new()
        .pick_folder();
    
    Ok(dir.map(|p| p.to_string_lossy().into_owned()))
}

#[tauri::command]
fn create_project_workspace(parent_dir: String, folder_name: String) -> Result<String, String> {
    let workspace_path = format!("{}/{}", parent_dir, folder_name);
    let media_path = format!("{}/media", workspace_path);
    
    fs::create_dir_all(&media_path)
        .map_err(|e| format!("创建工作区失败: {}", e))?;
        
    Ok(workspace_path)
}

#[tauri::command]
fn save_project_json(workspace_path: String, json_content: String) -> Result<(), String> {
    let file_path = format!("{}/project.json", workspace_path);
    fs::write(&file_path, json_content)
        .map_err(|e| format!("保存 project.json 失败: {}", e))?;
    Ok(())
}

#[tauri::command]
fn load_project_json(workspace_path: String) -> Result<String, String> {
    let file_path = format!("{}/project.json", workspace_path);
    fs::read_to_string(&file_path)
        .map_err(|e| format!("加载 project.json 失败: {}", e))?;
    Ok(fs::read_to_string(&file_path).unwrap())
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

    let media_path = format!("{}/{}", media_dir, filename);
    fs::write(&media_path, binary_data)
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
    Ok(())
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
            select_yrj_file_path_for_open,
            select_project_parent_dir,
            create_project_workspace,
            save_project_json,
            load_project_json,
            save_media_file,
            delete_media_file,
            pack_to_yrj,
            unpack_yrj,
            is_yrj_file_encrypted,
            open_devtools
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
