// 以苒纪 — Tauri 2.0 桥接服务

/**
 * 判断当前是否运行在 Tauri 壳体内
 */
export const isTauri = (): boolean => {
  return typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__ !== undefined;
};

/**
 * 动态加载 Tauri API
 * 这样在普通的 Web 浏览器中运行时不会因为打包找不到 window.__TAURI_INTERNALS__ 相关的模块而崩溃
 */
async function getTauriApi() {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return { invoke };
  }
  return null;
}

/**
 * 弹出原生保存文件对话框，选择 .yrj 保存路径
 */
export async function selectFilePathForSave(defaultName: string): Promise<string | null> {
  const api = await getTauriApi();
  if (!api) return null;
  return api.invoke<string | null>('select_yrj_file_path_for_save', { defaultName });
}

/**
 * 弹出原生保存文件对话框，选择 .zip 保存路径
 */
export async function selectFilePathForSaveZip(defaultName: string): Promise<string | null> {
  const api = await getTauriApi();
  if (!api) return null;
  return api.invoke<string | null>('select_zip_file_path_for_save', { defaultName });
}

/**
 * 弹出原生保存文件对话框，通用导出路径（按扩展名过滤）
 */
export async function selectExportFilePath(
  defaultName: string,
  filterName: string,
  extensions: string[]
): Promise<string | null> {
  const api = await getTauriApi();
  if (!api) return null;
  return api.invoke<string | null>('select_export_file_path', {
    defaultName,
    filterName,
    extensions,
  });
}

/**
 * 弹出原生打开文件对话框，选择 .yrj 文件
 */
export async function selectFilePathForOpen(): Promise<string | null> {
  const api = await getTauriApi();
  if (!api) return null;
  return api.invoke<string | null>('select_yrj_file_path_for_open');
}

/**
 * 选择父文件夹目录
 * @param defaultDir 对话框默认打开的目录（可为空，为空则使用系统默认位置）
 */
export async function selectProjectParentDir(defaultDir?: string | null): Promise<string | null> {
  const api = await getTauriApi();
  if (!api) return null;
  return api.invoke<string | null>('select_project_parent_dir', { defaultDir: defaultDir || null });
}

/**
 * 在系统文件管理器中打开指定路径（目录直接打开，文件则定位选中）
 */
export async function openInExplorer(path: string): Promise<void> {
  const api = await getTauriApi();
  if (!api) throw new Error('未运行在 Tauri 环境中');
  return api.invoke<void>('open_in_explorer', { path });
}

/**
 * 把整个档案工作区复制到新的父目录下（自动修正 project.json 内的绝对媒体路径），返回新工作区路径
 */
export async function moveProjectWorkspace(fromWorkspace: string, toParentDir: string): Promise<string> {
  const api = await getTauriApi();
  if (!api) throw new Error('未运行在 Tauri 环境中');
  return api.invoke<string>('move_project_workspace', {
    fromWorkspace,
    toParentDir,
  });
}

/**
 * 创建家谱工作区子目录
 */
export async function createProjectWorkspace(parentDir: string, folderName: string): Promise<string> {
  const api = await getTauriApi();
  if (!api) throw new Error('未运行在 Tauri 环境中');
  return api.invoke<string>('create_project_workspace', { parentDir, folderName });
}

/**
 * 创建导入用的工作区目录（同名时自动追加序号，避免覆盖已有档案）
 */
export async function createUniqueProjectWorkspace(parentDir: string, baseName: string): Promise<string> {
  const api = await getTauriApi();
  if (!api) throw new Error('未运行在 Tauri 环境中');
  return api.invoke<string>('create_unique_project_workspace', { parentDir, baseName });
}

/** 批量检查媒体文件是否存在 */
export async function checkMediaFilesExist(paths: string[]): Promise<boolean[]> {
  const api = await getTauriApi();
  if (!api || paths.length === 0) return paths.map(() => false);
  return api.invoke<boolean[]>('check_media_files_exist', { paths });
}

/** 释放随安装包发布的示例家谱，返回其工作区路径。若 force 为 true 则强制覆盖 */
export async function installSampleWorkspace(force = false): Promise<string> {
  const api = await getTauriApi();
  if (!api) throw new Error('未运行在 Tauri 环境中');
  return api.invoke<string>('install_sample_workspace', { force });
}

/**
 * 把用户选中的路径（文件夹或 .json）规范化成工程工作区目录
 */
export async function resolveWorkspaceDir(path: string): Promise<string> {
  const api = await getTauriApi();
  if (!api) throw new Error('未运行在 Tauri 环境中');
  return api.invoke<string>('resolve_workspace_dir', { path });
}

/**
 * 将明文项目 JSON 保存至工作区的 project.json
 */
export async function saveProjectJson(workspacePath: string, jsonContent: string): Promise<void> {
  const api = await getTauriApi();
  if (!api) return;
  return api.invoke<void>('save_project_json', { workspacePath, jsonContent });
}

/**
 * 从工作区加载 project.json 数据
 */
export async function loadProjectJson(workspacePath: string): Promise<string> {
  const api = await getTauriApi();
  if (!api) throw new Error('未运行在 Tauri 环境中');
  return api.invoke<string>('load_project_json', { workspacePath });
}

/**
 * 数据迁移前备份：把 project.json 复制为同目录下的 project.bak-{label}.json
 * 返回备份文件的绝对路径
 */
export async function backupProjectJson(workspacePath: string, label: string): Promise<string> {
  const api = await getTauriApi();
  if (!api) throw new Error('未运行在 Tauri 环境中');
  return api.invoke<string>('backup_project_json', { workspacePath, label });
}

/**
 * 解码 Base64 头像照片并独立保存至工作区 media/ 目录下
 */
export async function saveMediaFile(workspacePath: string, filename: string, base64Data: string): Promise<void> {
  const api = await getTauriApi();
  if (!api) return;
  return api.invoke<void>('save_media_file', { workspacePath, filename, base64Data });
}

/**
 * 删除工作区 media/ 目录下的媒体文件
 */
export async function deleteMediaFile(workspacePath: string, mediaPath: string): Promise<void> {
  const api = await getTauriApi();
  if (!api) return;
  return api.invoke<void>('delete_media_file', { workspacePath, mediaPath });
}

/**
 * 打包工作区为 .yrj 单文件
 */
export async function packToYrj(workspacePath: string, destYrjPath: string, password?: string): Promise<void> {
  const api = await getTauriApi();
  if (!api) return;
  return api.invoke<void>('pack_to_yrj', {
    workspacePath,
    destYrjPath,
    password: password || undefined,
  });
}

/**
 * 解包 .yrj 单文件至指定目录创建工作区，并返回工作区绝对路径
 */
export async function unpackYrj(yrjPath: string, parentDir: string, folderName: string, password?: string): Promise<string> {
  const api = await getTauriApi();
  if (!api) throw new Error('未运行在 Tauri 环境中');
  return api.invoke<string>('unpack_yrj', {
    yrjPath,
    parentDir,
    folderName,
    password: password || undefined,
  });
}

/**
 * 保存工程数据为 .yrj 文件（兼容老入口，但以后的主线为文件夹打包）
 */
export async function saveYrjFile(path: string, jsonContent: string, password?: string): Promise<void> {
  const api = await getTauriApi();
  if (!api) return;
  return api.invoke<void>('save_yrj_file', {
    path,
    jsonContent,
    password: password || undefined,
  });
}

/**
 * 读取 .yrj 文件数据为 JSON 字符串（兼容老入口）
 */
export async function loadYrjFile(path: string, password?: string): Promise<string> {
  const api = await getTauriApi();
  if (!api) throw new Error('未运行在 Tauri 环境中');
  return api.invoke<string>('load_yrj_file', {
    path,
    password: password || undefined,
  });
}

export async function isYrjFileEncrypted(path: string): Promise<boolean> {
  const api = await getTauriApi();
  if (!api) return false;
  return api.invoke<boolean>('is_yrj_file_encrypted', { path });
}

// 动态载入 convertFileSrc 以防 Web 浏览器不支持崩溃
let convertFileSrcFn: ((path: string) => string) | null = null;
if (isTauri()) {
  import('@tauri-apps/api/core').then((mod) => {
    convertFileSrcFn = mod.convertFileSrc;
  }).catch((err) => {
    console.error('动态加载 convertFileSrc 失败:', err);
  });
}

/**
 * 判断给定的媒体/头像路径在当前环境下是否可作为有效的 <img> src 显示
 * 在 Tauri 桌面环境下：只要有非空路径均可通过 convertLocalSrc 正常加载
 * 在纯 Web 环境下：仅支持 data: (Base64)、blob: 或 http(s): 在线 URL，
 *                  如果是本地磁盘绝对路径（如 D:\... 或 /Users/...），由于浏览器沙箱限制无法读取，返回 false
 */
export function canDisplaySrc(path?: string | null): path is string {
  if (!path || typeof path !== 'string') return false;
  const trimmed = path.trim();
  if (!trimmed) return false;
  if (isTauri()) return true;
  return (
    trimmed.startsWith('data:') ||
    trimmed.startsWith('blob:') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://')
  );
}

/**
 * 将本地绝对路径转换为可以直接在 img 标签渲染的协议 URL
 */
export function convertLocalSrc(path?: string | null): string {
  if (!path) return '';
  if (
    path.startsWith('data:') ||
    path.startsWith('blob:') ||
    path.startsWith('http://') ||
    path.startsWith('https://')
  ) {
    return path;
  }
  if (!isTauri()) {
    // 纯网页环境下，本地物理磁盘绝对路径浏览器无法直接访问
    return '';
  }
  const tauriInternals = (window as any).__TAURI_INTERNALS__;
  if (tauriInternals?.convertFileSrc) {
    return tauriInternals.convertFileSrc(path, 'asset');
  }
  if (convertFileSrcFn) {
    return convertFileSrcFn(path);
  }
  // 降级使用 Tauri 2.0 默认 asset 转换格式
  return `asset://localhost/${encodeURIComponent(path)}`;
}

/**
 * 使用系统默认浏览器打开外部链接（仅在 Tauri 环境下有效）
 */
export async function openUrl(url: string): Promise<void> {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-shell');
    await open(url);
  } else {
    window.open(url, '_blank');
  }
}

/**
 * 打开 WebView 的 DevTools（类似浏览器 F12 控制台）
 */
export async function openDevtools(): Promise<void> {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('open_devtools');
  } else {
    // Web 环境下尝试用浏览器原生方式
    console.log('DevTools 在 Web 环境下请按 F12 打开');
  }
}

/**
 * 前端首屏加载就绪后，主动通知 Tauri 唤醒并显示主窗口
 */
export async function showTauriWindow(): Promise<void> {
  if (isTauri()) {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const win = getCurrentWindow();
      await win.show();
    } catch (e) {
      console.error('显示窗口失败:', e);
    }
  }
}

/**
 * 将 Base64 编码的二进制数据写入指定文件路径
 */
export async function writeBinaryFile(path: string, base64Data: string): Promise<void> {
  const api = await getTauriApi();
  if (!api) throw new Error('未运行在 Tauri 环境中');
  return api.invoke<void>('write_binary_file', { path, base64Data });
}

/**
 * 获取 Tauri 应用日志文件列表
 * 返回 [{filename, content}, ...]
 */
export async function getAppLogs(): Promise<Array<{ filename: string; content: string }>> {
  if (isTauri()) {
    const api = await getTauriApi();
    if (!api) return [];
    const raw = await api.invoke<Array<[string, string]>>('get_app_logs');
    return raw.map(([filename, content]) => ({ filename, content }));
  }
  // Web 环境下尝试读取控制台日志（基本不可行），返回空
  return [];
}

// ==================== WebDAV 云同步 ====================

export interface RemoteSyncMeta {
  revision: number;
  updatedAt: string;
  projectUpdatedAt: string;
  device: string;
  mediaCount: number;
  familyName?: string;
  projectSize: number;
}

/** 云端根目录下的一个家谱 */
export interface RemoteProject extends RemoteSyncMeta {
  /** 云端子目录名，同时是该家谱的同步 ID */
  dir: string;
}

export interface SyncPushReport {
  revision: number;
  uploadedMedia: number;
  skippedMedia: number;
  totalMedia: number;
  uploadedBytes: number;
  projectBytes: number;
  remoteProjectUpdatedAt: string;
  remoteExisted: boolean;
}

export interface SyncPullReport {
  downloadedMedia: number;
  skippedMedia: number;
  totalRemoteMedia: number;
  projectBytes: number;
  backupPath: string;
  remote: RemoteSyncMeta;
}

/** 测试 WebDAV 连接，并自动创建云端目录 */
export async function webdavTest(
  server: string,
  username: string,
  password: string,
  remoteDir: string
): Promise<string> {
  const api = await getTauriApi();
  if (!api) throw new Error('云同步仅在桌面版可用');
  return api.invoke<string>('webdav_test', { server, username, password, remoteDir });
}

/** 读取云端同步元信息（不下载正文） */
export async function webdavRemoteMeta(
  server: string,
  username: string,
  password: string,
  remoteDir: string
): Promise<RemoteSyncMeta | null> {
  const api = await getTauriApi();
  if (!api) return null;
  return api.invoke<RemoteSyncMeta | null>('webdav_remote_meta', {
    server,
    username,
    password,
    remoteDir,
  });
}

/** 列出云端根目录下的家谱（换新电脑时用于恢复） */
export async function webdavListProjects(
  server: string,
  username: string,
  password: string,
  remoteRoot: string
): Promise<RemoteProject[]> {
  const api = await getTauriApi();
  if (!api) return [];
  return api.invoke<RemoteProject[]>('webdav_list_projects', {
    server,
    username,
    password,
    remoteRoot,
  });
}

/** 上传：project.json + 云端缺失的媒体文件 */export async function webdavPush(
  server: string,
  username: string,
  password: string,
  remoteDir: string,
  workspacePath: string,
  device?: string
): Promise<SyncPushReport> {
  const api = await getTauriApi();
  if (!api) throw new Error('云同步仅在桌面版可用');
  return api.invoke<SyncPushReport>('webdav_push', {
    server,
    username,
    password,
    remoteDir,
    workspacePath,
    device: device || null,
  });
}

/** 下载：备份本地 project.json 后覆盖，并补齐缺失媒体 */
export async function webdavPull(
  server: string,
  username: string,
  password: string,
  remoteDir: string,
  workspacePath: string
): Promise<SyncPullReport> {
  const api = await getTauriApi();
  if (!api) throw new Error('云同步仅在桌面版可用');
  return api.invoke<SyncPullReport>('webdav_pull', {
    server,
    username,
    password,
    remoteDir,
    workspacePath,
  });
}

// ==================== 统一软件设置（settings.json） ====================

export interface AppSettingsPayload {
  sync?: any;
  prefs?: any;
  recentProjects?: any[];
  [key: string]: any;
}

/** 从 settings.json 读取配置（WebDAV 密码已由后端自动解密） */
export async function loadAppSettings(): Promise<AppSettingsPayload | null> {
  const api = await getTauriApi();
  if (!api) return null;
  return api.invoke<AppSettingsPayload>('load_app_settings');
}

/** 保存配置到 settings.json（WebDAV 密码由后端进行高强度加密混淆后落盘） */
export async function saveAppSettings(settings: AppSettingsPayload): Promise<AppSettingsPayload | null> {
  const api = await getTauriApi();
  if (!api) return null;
  return api.invoke<AppSettingsPayload>('save_app_settings', { settings });
}

/** 获取 settings.json 文件的物理绝对路径 */
export async function getSettingsFilePath(): Promise<string | null> {
  const api = await getTauriApi();
  if (!api) return null;
  return api.invoke<string>('get_settings_file_path');
}

export interface FolderStats {
  totalBytes: number;
  fileCount: number;
  dirCount: number;
}

/** 递归统计工作区文件夹的总字节大小、文件数量与目录数量 */
export async function getWorkspaceStats(workspacePath: string): Promise<FolderStats> {
  const api = await getTauriApi();
  if (!api || !workspacePath) return { totalBytes: 0, fileCount: 0, dirCount: 0 };
  try {
    return await api.invoke<FolderStats>('get_workspace_stats', { workspacePath });
  } catch (err) {
    console.warn('获取工作区统计信息失败:', err);
    return { totalBytes: 0, fileCount: 0, dirCount: 0 };
  }
}
