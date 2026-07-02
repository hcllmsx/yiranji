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
 * 弹出原生打开文件对话框，选择 .yrj 文件
 */
export async function selectFilePathForOpen(): Promise<string | null> {
  const api = await getTauriApi();
  if (!api) return null;
  return api.invoke<string | null>('select_yrj_file_path_for_open');
}

/**
 * 选择父文件夹目录
 */
export async function selectProjectParentDir(): Promise<string | null> {
  const api = await getTauriApi();
  if (!api) return null;
  return api.invoke<string | null>('select_project_parent_dir');
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
 * 将本地绝对路径转换为可以直接在 img 标签渲染的协议 URL
 */
export function convertLocalSrc(path: string): string {
  if (!path) return '';
  if (path.startsWith('data:')) return path; // Web 端 Base64 直接返回
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
