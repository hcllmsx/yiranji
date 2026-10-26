// 以苒纪 — 统一软件设置管理（基于本地 settings.json 与高强度密码加密）
import { isTauri, loadAppSettings, saveAppSettings, getSettingsFilePath } from './tauri';

export type TreeLayoutMode = 'classic' | 'aligned';

export interface AppPrefs {
  /** 新建档案默认保存到的父目录；为空表示每次新建都弹出选择框 */
  defaultSaveDir?: string;
  /** 家谱树节点布局模式；未设置视为 classic（经典模式） */
  treeLayoutMode?: TreeLayoutMode;
  /** 已点击体验过示例家谱的软件版本号 */
  sampleDismissedVersion?: string;
  /** 上一次启动时的软件版本号；用于判断是否刚升级，决定要不要展示本次更新内容 */
  lastRunVersion?: string;
  /** 重大更新提示已读：本次大改版启动后只提示一次，读过就不再弹 */
  majorUpdateNoticeDismissed?: boolean;
}

export interface SyncSettings {
  /** 总开关：关掉后不显示云端更新提示 */
  enabled: boolean;
  /** WebDAV 服务地址，如 https://your-webdav.com/webdav/ */
  server: string;
  username: string;
  password: string;
  /** 云端根目录（每个家谱会再建一个以同步 ID 命名的子目录） */
  remoteRoot: string;
  /** 打开档案时自动检查云端是否有更新 */
  autoCheck: boolean;
}

export const DEFAULT_SYNC_SETTINGS: SyncSettings = {
  enabled: false,
  server: '',
  username: '',
  password: '',
  remoteRoot: 'yiranji',
  autoCheck: true,
};

const SYNC_STORAGE_KEY = 'yiranji_sync_settings_v1';
const PREFS_STORAGE_KEY = 'yiranji_app_prefs';
const RECENT_STORAGE_KEY = 'yiranji_recent_projects';

// 同步初始缓存（首帧同步读取，避免异步导致组件闪烁）
function readInitialSync(): SyncSettings {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(SYNC_STORAGE_KEY) : null;
    if (!raw) return { ...DEFAULT_SYNC_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<SyncSettings>;
    return { ...DEFAULT_SYNC_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SYNC_SETTINGS };
  }
}

function readInitialPrefs(): AppPrefs {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(PREFS_STORAGE_KEY) : null;
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as AppPrefs;
  } catch {
    return {};
  }
}

function readInitialRecent(): any[] {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(RECENT_STORAGE_KEY) : null;
    if (!raw) return [];
    return JSON.parse(raw) || [];
  } catch {
    return [];
  }
}

let cachedSync: SyncSettings = readInitialSync();
let cachedPrefs: AppPrefs = readInitialPrefs();
let cachedRecent: any[] = readInitialRecent();
let isInitialized = false;

type Listener = () => void;
const listeners = new Set<Listener>();

function notifyChange() {
  listeners.forEach(fn => {
    try {
      fn();
    } catch {
      // 忽略回调执行异常
    }
  });
}

export function subscribeSettings(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 触发将当前内存设置持久化到本地 settings.json（静默异步） */
async function persistToDisk() {
  if (!isTauri()) return;
  try {
    await saveAppSettings({
      sync: cachedSync,
      prefs: cachedPrefs,
      recentProjects: cachedRecent,
    });
  } catch (err) {
    console.warn('持久化 settings.json 失败:', err);
  }
}

/**
 * 初始化设置：在应用启动时从本地 settings.json 加载
 * 如果 settings.json 不存在（首次升级），自动把现有的 localStorage 配置迁移进去
 */
export async function initAppSettings(): Promise<void> {
  if (isInitialized) return;
  isInitialized = true;

  if (!isTauri()) return;

  try {
    const diskSettings = await loadAppSettings();
    if (diskSettings && (diskSettings.sync || diskSettings.prefs || diskSettings.recentProjects)) {
      if (diskSettings.sync) {
        cachedSync = { ...DEFAULT_SYNC_SETTINGS, ...diskSettings.sync };
        try {
          localStorage.setItem(SYNC_STORAGE_KEY, JSON.stringify(cachedSync));
        } catch {}
      }
      if (diskSettings.prefs) {
        cachedPrefs = { ...diskSettings.prefs };
        if (!cachedPrefs.sampleDismissedVersion) {
          delete cachedPrefs.sampleDismissedVersion;
        }
        if (!cachedPrefs.defaultSaveDir) {
          delete cachedPrefs.defaultSaveDir;
        }
        try {
          localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(cachedPrefs));
        } catch {}
      }
      if (Array.isArray(diskSettings.recentProjects)) {
        cachedRecent = diskSettings.recentProjects;
        try {
          localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(cachedRecent));
        } catch {}
      }
      notifyChange();
    } else {
      // settings.json 为空，把旧的 localStorage 数据落盘迁移
      await persistToDisk();
    }
  } catch (err) {
    console.warn('读取 settings.json 失败，保留当前缓存:', err);
  }
}

/** 读取 WebDAV 云同步设置（同步） */
export function getSyncSettings(): SyncSettings {
  return cachedSync;
}

/** 保存 WebDAV 云同步设置并异步落盘 */
export function saveSyncSettings(patch: Partial<SyncSettings>): SyncSettings {
  cachedSync = { ...cachedSync, ...patch };
  try {
    localStorage.setItem(SYNC_STORAGE_KEY, JSON.stringify(cachedSync));
  } catch {}
  notifyChange();
  persistToDisk();
  return cachedSync;
}

/** 读取全局应用偏好设置（同步） */
export function getAppPrefs(): AppPrefs {
  return cachedPrefs;
}

/** 保存全局应用偏好设置并异步落盘 */
export function saveAppPrefs(next: AppPrefs): AppPrefs {
  cachedPrefs = { ...next };
  if (!cachedPrefs.sampleDismissedVersion) {
    delete cachedPrefs.sampleDismissedVersion;
  }
  if (!cachedPrefs.defaultSaveDir) {
    delete cachedPrefs.defaultSaveDir;
  }
  try {
    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(cachedPrefs));
  } catch {}
  notifyChange();
  persistToDisk();
  return cachedPrefs;
}

/** 读取最近打开项目列表 */
export function getRecentProjectsList(): any[] {
  return cachedRecent;
}

/** 保存最近打开项目列表并落盘 */
export function saveRecentProjectsList(list: any[]): void {
  cachedRecent = list;
  try {
    localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(list));
  } catch {}
  persistToDisk();
}

/** 获取 settings.json 的绝对路径 */
export async function getSettingsPath(): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    return await getSettingsFilePath();
  } catch {
    return null;
  }
}
