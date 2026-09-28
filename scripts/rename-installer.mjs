// 打包后处理：
// 1. 为 NSIS 安装包文件名的版本号加上 v 前缀
//    例：以苒纪_26.9.28_x64-setup.exe -> 以苒纪_v26.9.28_x64-setup.exe
// 2. 将安装包复制到项目根目录 output/ 文件夹（发布目录）
// 3. 在 output/ 中生成同名的 .sha256 校验文件（内容格式与 sha256sum 一致）
//
// Tauri 的安装包文件名由 productName/version/arch 自动生成，无法通过配置自定义，
// 且 tauri.conf.json 的 version 字段必须为纯 semver（不能带 v），故在打包完成后重命名。
// 用法：npm run build:installer （会先执行 tauri build，再调用本脚本）

import { readdir, rename, writeFile, mkdir, copyFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { join, resolve } from 'node:path';

const bundleDir = resolve(process.cwd(), 'src-tauri/target/release/bundle/nsis');
const outputDir = resolve(process.cwd(), 'output');

if (!existsSync(bundleDir)) {
  console.log('[post-build] 未找到 NSIS 打包目录，跳过后处理');
  process.exit(0);
}

// 确保 output 目录存在
await mkdir(outputDir, { recursive: true });

// 清理 output 中上一次打包留下的安装包与校验文件（只删匹配文件，不动其他内容）
for (const old of await readdir(outputDir)) {
  if (old.endsWith('-setup.exe') || old.endsWith('-setup.exe.sha256')) {
    await rm(join(outputDir, old));
    console.log(`[post-build] 清理旧产物: output/${old}`);
  }
}

/**
 * 流式计算文件 SHA256（安装包较大，避免整读入内存）
 */
function sha256File(filePath) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolveHash(hash.digest('hex')));
    stream.on('error', reject);
  });
}

const files = await readdir(bundleDir);
let renamed = 0;
let published = 0;

for (const file of files) {
  if (!file.endsWith('-setup.exe')) continue;
  const filePath = join(bundleDir, file);

  // ---- 1. 重命名：{productName}_{纯数字版本}_{架构}-setup.exe 加 v 前缀 ----
  const match = file.match(/^(.+?)_(\d+(?:\.\d+)+)_(x64|x86|arm64)-setup\.exe$/);
  let finalName = file;

  if (match) {
    const [, productName, version, arch] = match;
    finalName = `${productName}_v${version}_${arch}-setup.exe`;

    if (finalName !== file) {
      await rename(filePath, join(bundleDir, finalName));
      console.log(`[post-build] 重命名: ${file} -> ${finalName}`);
      renamed++;
    }
  }

  // ---- 2. 复制安装包到 output/ 发布目录 ----
  const finalPath = join(bundleDir, finalName);
  const outputPath = join(outputDir, finalName);
  await copyFile(finalPath, outputPath);

  // ---- 3. 在 output/ 中生成 SHA256 校验文件 ----
  const hash = await sha256File(outputPath);
  const hashPath = join(outputDir, `${finalName}.sha256`);
  // 与 GNU sha256sum 输出格式一致，可直接用 certutil/sha256sum -c 校验
  await writeFile(hashPath, `${hash}  ${finalName}\n`, 'utf8');

  console.log(`[post-build] 发布: output/${finalName}`);
  console.log(`[post-build] 校验: output/${finalName}.sha256`);
  published++;
}

console.log(`[post-build] 完成：重命名 ${renamed} 个，发布 ${published} 个至 output/`);
