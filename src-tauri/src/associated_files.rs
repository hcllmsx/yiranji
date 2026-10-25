//! 系统文件关联的冷启动参数、单实例转发与前端就绪握手。

use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

pub const OPEN_EVENT: &str = "associated-file-open";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenFileRequest {
    pub id: u64,
    pub paths: Vec<String>,
}

#[derive(Debug)]
pub struct AssociatedFilesState {
    next_id: AtomicU64,
    pending: Mutex<Vec<OpenFileRequest>>,
}

impl AssociatedFilesState {
    pub fn new(initial_paths: Vec<String>) -> Self {
        let pending = if initial_paths.is_empty() {
            Vec::new()
        } else {
            vec![OpenFileRequest {
                id: 1,
                paths: initial_paths,
            }]
        };
        Self {
            next_id: AtomicU64::new(2),
            pending: Mutex::new(pending),
        }
    }
}

pub fn paths_from_args(args: impl IntoIterator<Item = String>) -> Vec<String> {
    args.into_iter()
        .filter(|arg| {
            Path::new(arg)
                .extension()
                .and_then(|ext| ext.to_str())
                .map(|ext| ext.eq_ignore_ascii_case("yrp") || ext.eq_ignore_ascii_case("yrj"))
                .unwrap_or(false)
        })
        .collect()
}

pub fn dispatch(app: &AppHandle, paths: Vec<String>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
    if paths.is_empty() {
        return;
    }
    let state = app.state::<AssociatedFilesState>();
    let request = OpenFileRequest {
        id: state.next_id.fetch_add(1, Ordering::Relaxed),
        paths,
    };
    if let Ok(mut pending) = state.pending.lock() {
        pending.push(request.clone());
    }
    let _ = app.emit(OPEN_EVENT, request);
}

/// 前端先注册事件监听，再读取等待中的请求，避免冷启动丢参数。
/// 请求在真正打开、失败或用户取消后才确认移除，因此密码等待期间重载也不会丢失。
#[tauri::command]
pub fn take_pending_associated_files(app: AppHandle) -> Vec<OpenFileRequest> {
    let state = app.state::<AssociatedFilesState>();
    state
        .pending
        .lock()
        .map(|pending| pending.clone())
        .unwrap_or_default()
}

fn acknowledge_pending_path(pending: &mut Vec<OpenFileRequest>, id: u64, path: &str) {
    if let Some(request) = pending.iter_mut().find(|request| request.id == id) {
        if let Some(index) = request.paths.iter().position(|candidate| candidate == path) {
            request.paths.remove(index);
        }
    }
    pending.retain(|request| !request.paths.is_empty());
}

/// 单个路径处理结束后移除；请求内其他路径仍保留，刷新后不会重放已完成项。
#[tauri::command]
pub fn acknowledge_associated_file(app: AppHandle, id: u64, path: String) {
    let state = app.state::<AssociatedFilesState>();
    if let Ok(mut pending) = state.pending.lock() {
        acknowledge_pending_path(&mut pending, id, &path);
    };
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn args_only_keep_yrp_and_yrj_case_insensitively() {
        let args = vec![
            "app.exe".into(),
            "--flag".into(),
            "A/project.YRP".into(),
            "B/package.YrJ".into(),
            "notes.json".into(),
        ];
        assert_eq!(
            paths_from_args(args),
            vec!["A/project.YRP", "B/package.YrJ"]
        );
    }

    #[test]
    fn acknowledgement_removes_only_the_completed_path() {
        let mut pending = vec![OpenFileRequest {
            id: 7,
            paths: vec!["A.yrp".into(), "B.yrj".into()],
        }];
        acknowledge_pending_path(&mut pending, 7, "A.yrp");
        assert_eq!(pending[0].paths, vec!["B.yrj"]);
        acknowledge_pending_path(&mut pending, 7, "B.yrj");
        assert!(pending.is_empty());
    }
}
