// 以苒纪 — 检查更新
//
// 版本源为 GitHub 仓库根目录的 VERSION 文件（纯文本版本号，如 26.9.28）。
// 考虑到国内网络访问 GitHub 不稳定，默认优先走 gh-proxy 加速镜像，
// 镜像不通再回退 GitHub 原始源；全部失败时返回 failed 状态，
// 由调用方决定是否提示（静默检查不提示，手动检查才 toast）。

/** gh-proxy 加速镜像（gh-proxy.com 与 gh-proxy.org 为同一服务的双域名） */
const REMOTE_VERSION_SOURCES = [
  'https://gh-proxy.com/https://raw.githubusercontent.com/hcllmsx/yiranji/refs/heads/main/VERSION',
  'https://gh-proxy.org/https://raw.githubusercontent.com/hcllmsx/yiranji/refs/heads/main/VERSION',
  // 镜像都不通时回退 GitHub 原始源
  'https://raw.githubusercontent.com/hcllmsx/yiranji/refs/heads/main/VERSION',
];

/** 最新版下载页 */
export const RELEASES_URL = 'https://github.com/hcllmsx/yiranji/releases/latest';

/** 单个源的超时时间（毫秒） */
const SOURCE_TIMEOUT_MS = 8000;

export type UpdateStatus = 'update-available' | 'up-to-date' | 'failed';

export interface UpdateCheckResult {
  status: UpdateStatus;
  /** 远端最新版本号（仅成功时有效） */
  latestVersion?: string;
  /** 失败原因（仅 failed 时有效） */
  error?: string;
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
  let lastError = '';
  for (const url of REMOTE_VERSION_SOURCES) {
    try {
      const text = await fetchTextWithTimeout(url, SOURCE_TIMEOUT_MS);
      // 校验内容形如 26.9.28，防止拿到代理错误页
      if (/^\d+(\.\d+)+$/.test(text)) {
        latestVersion = text;
        break;
      }
      lastError = '版本源返回内容异常';
    } catch (err) {
      lastError = (err as Error)?.message || '网络错误';
      console.warn(`检查更新：版本源不可达（${url}）`, err);
    }
  }

  if (!latestVersion) {
    return { status: 'failed', error: lastError || '无法连接更新服务器' };
  }

  return {
    status: isNewerVersion(latestVersion, localVersion) ? 'update-available' : 'up-to-date',
    latestVersion,
  };
}
