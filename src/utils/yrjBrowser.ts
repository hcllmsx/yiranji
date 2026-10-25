// 以苒纪 — 浏览器端 YRJ 打包
//
// 桌面版由 Rust 侧（src-tauri/src/yrj_file.rs）把工作区压成 ZIP 再套上
// 「YIRANJI」文件头；浏览器里没有文件系统，但可以用 JSZip + WebCrypto
// 生成**完全一致**的容器格式，因此网页版导出的 .yrj 也能被桌面版「打开/导入」。
//
// 容器结构：
//   [0..8)    MAGIC  "YIRANJI\0"
//   [8..12)   version u32 LE（当前为 2，包内工程为 project.yrp）
//   [12]      flags  bit0 = 1 表示 AES-256-GCM 加密
//   [13..45)  salt（32 字节，未加密时为全 0）
//   [45..57)  iv（12 字节，未加密时为全 0）
//   [57..)    ZIP 明文，或 ZIP 的 AES-GCM 密文（含 16 字节 tag）
//
// 加密参数与 Rust 侧保持一致：PBKDF2-HMAC-SHA256，10000 轮，派生 256 位密钥。

import type { FamilyProject } from '../types';

const MAGIC = [0x59, 0x49, 0x52, 0x41, 0x4e, 0x4a, 0x49, 0x00]; // "YIRANJI\0"
const VERSION = 2;
const PBKDF2_ITERATIONS = 10000;
const HEADER_SIZE = 57;
const YRP_MAGIC = [0x59, 0x49, 0x52, 0x41, 0x4e, 0x4a, 0x50, 0x00]; // "YIRANJP\0"

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/** ArrayBuffer / Uint8Array → base64（分块，避免大文件栈溢出） */
export function bytesToBase64(bytes: Uint8Array): string {
  const chunk = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunk)) as unknown as number[]
    );
  }
  return btoa(binary);
}

async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );
}

/** 与 Rust project_file 模块一致：16 字节 YRP 文件头 + UTF-8 JSON。 */
function encodeYrpProject(project: FamilyProject): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(project, null, 2));
  const out = new Uint8Array(16 + json.length);
  out.set(YRP_MAGIC, 0);
  new DataView(out.buffer).setUint32(8, 1, true);
  out.set(json, 16);
  return out;
}

/**
 * 把工程数据打包成 .yrj 字节流（与桌面版容器格式一致）。
 *
 * 内嵌的 base64 媒体原样保留在 YRP 的 JSON 数据里：桌面版打开时会把它
 * 还原成 media/ 下的实体文件，因此网页版的照片、音频不会丢。
 */
export async function buildYrjBytes(
  project: FamilyProject,
  password?: string
): Promise<Uint8Array> {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  zip.file('project.yrp', encodeYrpProject(project));
  const zipBytes = new Uint8Array(
    await zip.generateAsync({
      type: 'uint8array',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    })
  );

  const header = new Uint8Array(HEADER_SIZE);
  header.set(MAGIC, 0);
  new DataView(header.buffer).setUint32(8, VERSION, true);

  if (!password) {
    // flags = 0，salt / iv 保持全 0
    return concatBytes(header, zipBytes);
  }

  header[12] = 1;
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  header.set(salt, 13);
  header.set(iv, 45);

  const key = await deriveKey(password, salt);
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, zipBytes);
  return concatBytes(header, new Uint8Array(cipher));
}

/** 触发浏览器下载 */
function triggerDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * 浏览器环境「另存为 YRJ」：直接下载单文件档案。
 * 返回 'saved'，保持与桌面版保存对话框相同的返回语义。
 */
export async function exportYrjInBrowser(
  project: FamilyProject,
  fileName: string,
  password?: string
): Promise<'saved' | 'cancelled'> {
  const bytes = await buildYrjBytes(project, password);
  const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/octet-stream' });
  triggerDownload(blob, fileName);
  return 'saved';
}
