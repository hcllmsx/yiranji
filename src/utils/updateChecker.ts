// 以苒纪 — 检查更新
//
// 版本源为 GitHub 仓库根目录的 VERSION 文件（纯文本版本号，如 26.9.28）。
// 考虑到国内网络访问 GitHub 不稳定，默认优先走 gh-proxy 加速镜像，
// 镜像不通再回退 GitHub 原始源；全部失败时返回 failed 状态，
// 由调用方决定是否提示（静默检查不提示，手动检查才 toast）。
//
// 更新内容来自 release-notes.json：由 scripts/sync-version.mjs 从 CHANGELOG.md
// 当前版本一节生成，只含单版本的结构化数据，客户端无需解析 Markdown。

/** 源根目录：镜像优先，最后回退 GitHub 官方（同源策略靠同一数组派生 URL 保证） */
const SOURCES = [
  'https://gh-proxy.com/https://raw.githubusercontent.com/hcllmsx/yiranji/refs/heads/main',
  'https://gh-proxy.org/https://raw.githubusercontent.com/hcllmsx/yiranji/refs/heads/main',
  'https://raw.githubusercontent.com/hcllmsx/yiranji/refs/heads/main',
];

const VERSION_URLS = SOURCES.map((src) => `${src}/VERSION`);
const RELEASE_NOTES_URLS = SOURCES.map((src) => `${src}/release-notes.json`);

/** 最新版下载页 */
export const RELEASES_URL = 'https://github.com/hcllmsx/yiranji/releases/latest';

/** 单个源的超时时间（毫秒） */
const SOURCE_TIMEOUT_MS = 6000;

export type UpdateStatus = 'update-available' | 'up-to-date' | 'failed';

export interface UpdateCheckResult {
  status: UpdateStatus;
  /** 远端最新版本号（仅成功时有效） */
  latestVersion?: string;
  /** 成功返回版本号的源索引（用于更新说明的同源拉取） */
  sourceIndex?: number;
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
    return (await resp.text()).trim();
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
 * 检查更新：依次尝试镜像与原始源获取远端 VERSION，与本地版本比较。
 * 本地版本由 vite define 注入（构建时读取仓库根目录 VERSION 文件）。
 */
export async function checkForUpdate(): Promise<UpdateCheckResult> {
  const localVersion = __APP_VERSION__;

  let latestVersion = '';
  let latestSourceIndex = -1;
  let lastError = '';

  for (let i = 0; i < VERSION_URLS.length; i++) {
    try {
      const text = await fetchTextWithTimeout(VERSION_URLS[i], SOURCE_TIMEOUT_MS);
      // 校验内容形如 26.9.28，防止拿到代理错误页
      if (/^\d+(\.\d+)+$/.test(text)) {
        latestVersion = text;
        latestSourceIndex = i;
        break;
      }
      lastError = '版本源返回内容异常';
    } catch (err) {
      lastError = (err as Error)?.message || '网络错误';
      console.warn(`检查更新：版本源不可达（${VERSION_URLS[i]}）`, err);
    }
  }

  if (!latestVersion || latestSourceIndex < 0) {
    return { status: 'failed', error: lastError || '无法连接更新服务器' };
  }

  return {
    status: isNewerVersion(latestVersion, localVersion) ? 'update-available' : 'up-to-date',
    latestVersion,
    sourceIndex: latestSourceIndex,
  };
}

/**
 * 获取当前版本的更新说明：优先从 VERSION 成功的同一个源拉取，
 * 同源失败才回退其他源；版本不匹配或内容不合法一律忽略。
 */
export async function fetchReleaseNotes(
  latestVersion: string,
  preferredSourceIndex = 0
): Promise<ReleaseNotes | null> {
  const order = [
    preferredSourceIndex,
    ...SOURCES.map((_, i) => i).filter((i) => i !== preferredSourceIndex),
  ];

  for (const index of order) {
    try {
      const text = await fetchTextWithTimeout(RELEASE_NOTES_URLS[index], SOURCE_TIMEOUT_MS);
      const data = JSON.parse(text) as unknown;
      if (!data || typeof data !== 'object') continue;

      const record = data as { version?: unknown; sections?: unknown };
      if (record.version !== latestVersion || !Array.isArray(record.sections)) continue;

      const sections: ReleaseNoteSection[] = [];
      for (const raw of record.sections) {
        if (!raw || typeof raw !== 'object') continue;
        const section = raw as { title?: unknown; items?: unknown };
        if (typeof section.title !== 'string' || !Array.isArray(section.items)) continue;

        const items = section.items.filter((item): item is string => typeof item === 'string');
        if (items.length > 0) {
          sections.push({ title: section.title, items });
        }
      }

      if (sections.length > 0) {
        return { version: latestVersion, sections };
      }
    } catch (err) {
      console.warn(`检查更新：更新说明拉取失败（${RELEASE_NOTES_URLS[index]}）`, err);
    }
  }

  return null;
}
