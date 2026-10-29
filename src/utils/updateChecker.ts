// 以苒纪 — 检查更新
//
// 版本源为 GitHub 上最新的正式 Release（releases/latest），取其 tag 名（v26.10.29）。
// 只有打了 tag 并成功发布 Release 才算正式发版，因此改完 VERSION 但还没打 tag 时
// 不会提示更新，避免把用户引到一个尚不存在的发布页。
// 更新内容直接取该 Release 正文里「更新内容」一节（与发布公告同源，天然对应 tag）。
//
// 考虑到国内网络访问 GitHub 不稳定，默认优先走 gh-proxy 加速镜像，
// 镜像不通再回退 GitHub 原始源；全部失败时返回 failed 状态，
// 由调用方决定是否提示（静默检查不提示，手动检查才 toast）。

/** Release 信息接口：镜像优先，最后回退 GitHub 官方（同源策略靠同一数组派生 URL 保证） */
const SOURCES = [
  'https://gh-proxy.com/https://api.github.com/repos/hcllmsx/yiranji/releases/latest',
  'https://gh-proxy.org/https://api.github.com/repos/hcllmsx/yiranji/releases/latest',
  'https://api.github.com/repos/hcllmsx/yiranji/releases/latest',
];

/** 最新版下载页 */
export const RELEASES_URL = 'https://github.com/hcllmsx/yiranji/releases/latest';

/** 单个源的超时时间（毫秒） */
const SOURCE_TIMEOUT_MS = 6000;

export type UpdateStatus = 'update-available' | 'up-to-date' | 'failed';

export interface UpdateCheckResult {
  status: UpdateStatus;
  /** 远端最新版本号（仅成功时有效） */
  latestVersion?: string;
  /** 失败原因（仅 failed 时有效） */
  error?: string;
}

export interface ReleaseNoteSection {
  title: string;
  items: string[];
}

export interface ReleaseNotes {
  version: string;
  sections: ReleaseNoteSection[];
}

/** 最近一次成功拉取的 Release，用于打开弹窗时免去二次联网 */
let cachedRelease: ReleaseNotes | null = null;

/**
 * 带超时的文本抓取
 */
async function fetchTextWithTimeout(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }
    return await resp.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 版本号比较：a 是否比 b 更新（形如 26.9.28 的纯数字段版本号）
 */
export function isNewerVersion(a: string, b: string): boolean {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va !== vb) return va > vb;
  }
  return false;
}

/**
 * 解析 Release 正文里「更新内容」一节：只认 --- 分隔线之前的 ### 小标题与 - 条目，
 * 其后的网盘二维码引导不属于更新说明。
 */
function parseReleaseBody(body: string): ReleaseNoteSection[] {
  const sections: ReleaseNoteSection[] = [];
  let current: ReleaseNoteSection | null = null;

  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '---') break;
    if (!line) continue;

    const heading = /^###\s+(.+)$/.exec(line);
    if (heading) {
      current = { title: heading[1].trim(), items: [] };
      sections.push(current);
      continue;
    }

    const item = /^[-*]\s+(.+)$/.exec(line);
    if (item) {
      if (!current) {
        current = { title: '更新内容', items: [] };
        sections.push(current);
      }
      current.items.push(item[1].trim());
    }
  }

  return sections.filter((section) => section.items.length > 0);
}

/**
 * 从 Release JSON 中提取版本号与更新说明；tag 形如 v26.10.29，也兼容不带 v 的写法。
 */
function parseReleaseJson(text: string): { version: string; sections: ReleaseNoteSection[] } | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;

  const record = data as { tag_name?: unknown; body?: unknown };
  if (typeof record.tag_name !== 'string') return null;

  const version = record.tag_name.trim().replace(/^v/i, '');
  // 校验内容形如 26.9.28，防止拿到代理错误页
  if (!/^\d+(\.\d+)+$/.test(version)) return null;

  const sections = typeof record.body === 'string' ? parseReleaseBody(record.body) : [];
  return { version, sections };
}

/**
 * 依次尝试镜像与原始源获取最新正式 Release。
 */
async function fetchLatestRelease(): Promise<{ release: ReleaseNotes | null; error: string }> {
  let lastError = '';

  for (const url of SOURCES) {
    try {
      const text = await fetchTextWithTimeout(url, SOURCE_TIMEOUT_MS);
      const parsed = parseReleaseJson(text);
      if (parsed) {
        return { release: parsed, error: '' };
      }
      lastError = '版本源返回内容异常';
    } catch (err) {
      lastError = (err as Error)?.message || '网络错误';
      console.warn(`检查更新：版本源不可达（${url}）`, err);
    }
  }

  return { release: null, error: lastError || '无法连接更新服务器' };
}

/**
 * 检查更新：以远端最新 Release 的 tag 版本与本地版本比较。
 * 本地版本由 vite define 注入（构建时读取仓库根目录 VERSION 文件）。
 */
export async function checkForUpdate(): Promise<UpdateCheckResult> {
  const localVersion = __APP_VERSION__;

  const { release, error } = await fetchLatestRelease();
  if (!release) {
    return { status: 'failed', error };
  }

  cachedRelease = release;

  return {
    status: isNewerVersion(release.version, localVersion) ? 'update-available' : 'up-to-date',
    latestVersion: release.version,
  };
}

/**
 * 获取指定版本的更新说明：命中缓存直接用，否则重新拉取 Release 后校验版本，
 * 版本不一致一律视为不可用。
 */
export async function fetchReleaseNotes(latestVersion: string): Promise<ReleaseNotes | null> {
  let release = cachedRelease;
  if (!release || release.version !== latestVersion) {
    release = (await fetchLatestRelease()).release;
  }
  if (!release || release.version !== latestVersion || release.sections.length === 0) {
    return null;
  }

  return release;
}
