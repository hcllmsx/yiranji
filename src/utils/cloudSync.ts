// 以苒纪 — 多设备云同步（WebDAV）
//
// 云端只存三样东西：project.json、media/ 下的媒体文件、sync.json（同步元信息）。
// 上传时只补齐云端缺失的媒体，所以同一个家谱反复同步几乎不消耗流量。

import type { FamilyProject } from '../types';
import type { SyncSettings } from './appSettings';
import {
  DEFAULT_SYNC_SETTINGS,
  getSyncSettings,
  saveSyncSettings,
} from './appSettings';

export type { SyncSettings };
export { DEFAULT_SYNC_SETTINGS, getSyncSettings, saveSyncSettings };

/** 是否已经填好足够发起同步的信息 */
export function isSyncConfigured(s: SyncSettings = getSyncSettings()): boolean {
  return !!s.server.trim() && !!s.username.trim() && !!s.password;
}

/** 同步目录名：组合云端根目录与家谱目录名（如 yiranji/示例家谱） */
export function remoteDirFor(settings: SyncSettings, syncKey: string): string {
  const root = (settings.remoteRoot || 'yiranji').trim().replace(/^\/+|\/+$/g, '');
  const key = (syncKey || '以苒纪家谱').trim().replace(/^\/+|\/+$/g, '');
  return `${root}/${key}`;
}

/** 获取家谱在云端的直观文件夹名（以家谱名称为准，清洗文件名非法字符） */
export function getFamilyCloudFolder(project: FamilyProject): string {
  const raw = (project.meta.familyName || '').trim() || '以苒纪家谱';
  return raw.replace(/[\\/:*?"<>|\r\n\t]/g, '_');
}

/** 取家谱的同步目录标识：直接使用直观家谱名称 */
export function ensureSyncKey(project: FamilyProject): { key: string; created: boolean } {
  const folderName = getFamilyCloudFolder(project);
  return { key: folderName, created: project.meta.syncKey !== folderName };
}

/** 把 ISO 时间格式化成完整日期时间「YYYY-MM-DD HH:mm:ss」 */
export function formatSyncTime(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());
  const seconds = pad(d.getSeconds());
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/** 人类可读的体积 */
export function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
