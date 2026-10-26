import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const rootDir = path.resolve(import.meta.dirname, '..');
const versionPath = path.join(rootDir, 'VERSION');
const version = fs.readFileSync(versionPath, 'utf8').trim();

const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

if (!semverPattern.test(version)) {
  console.error(`Invalid VERSION value: "${version}". Expected semver like 0.1.2 or 2026.7.2; numeric parts cannot have leading zeroes.`);
  process.exit(1);
}

function writeJsonVersion(relativePath, update) {
  const filePath = path.join(rootDir, relativePath);
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  update(data);
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function replacePackageVersion(content, version) {
  const lines = content.split(/(?<=\n)/);
  let inPackage = false;
  let replaced = false;

  const updatedLines = lines.map((line) => {
    const trimmed = line.trim();

    if (/^\[.*\]$/.test(trimmed)) {
      inPackage = trimmed === '[package]';
    }

    if (inPackage && /^version\s*=/.test(trimmed)) {
      replaced = true;
      const newline = line.endsWith('\r\n') ? '\r\n' : line.endsWith('\n') ? '\n' : '';
      return `version = "${version}"${newline}`;
    }

    return line;
  });

  if (!replaced) {
    throw new Error('Cannot find [package] version in src-tauri/Cargo.toml');
  }

  return updatedLines.join('');
}

function replaceCargoLockAppVersion(content, version) {
  const appPackage = content.match(/(^\[\[package\]\]\r?\nname = "app"\r?\n)(version = ")[^"]*(")/m);
  if (!appPackage) {
    throw new Error('Cannot find app package version in src-tauri/Cargo.lock');
  }

  return content.replace(appPackage[0], `${appPackage[1]}${appPackage[2]}${version}${appPackage[3]}`);
}

/** 取出 CHANGELOG 中指定版本（形如 ## v26.10.24）到下一个二级标题之间的正文 */
function readChangelogSection(markdown, targetVersion) {
  const lines = markdown.split(/\r?\n/);
  let start = -1;
  let end = lines.length;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('## ')) continue;

    let heading = line.slice(3).trim();
    if (heading.startsWith('[') && heading.endsWith(']')) {
      heading = heading.slice(1, -1);
    }
    heading = heading.replace(/^v/, '').trim();

    if (start === -1) {
      if (heading === targetVersion) start = i + 1;
    } else {
      end = i;
      break;
    }
  }

  return start === -1 ? null : lines.slice(start, end);
}

/** 把更新说明正文解析为 [{ title, items }]，只认 ### 小标题与 - 条目 */
function parseChangelogSections(bodyLines) {
  const sections = [];
  let current = null;

  for (const raw of bodyLines) {
    const line = raw.trim();
    if (!line || line === '---') continue;

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

writeJsonVersion('package.json', (data) => {
  data.version = version;
});

writeJsonVersion('package-lock.json', (data) => {
  data.version = version;
  if (data.packages?.['']) {
    data.packages[''].version = version;
  }
});

writeJsonVersion('src-tauri/tauri.conf.json', (data) => {
  data.version = version;
});

const cargoTomlPath = path.join(rootDir, 'src-tauri', 'Cargo.toml');
fs.writeFileSync(
  cargoTomlPath,
  replacePackageVersion(fs.readFileSync(cargoTomlPath, 'utf8'), version)
);

const cargoLockPath = path.join(rootDir, 'src-tauri', 'Cargo.lock');
if (fs.existsSync(cargoLockPath)) {
  fs.writeFileSync(
    cargoLockPath,
    replaceCargoLockAppVersion(fs.readFileSync(cargoLockPath, 'utf8'), version)
  );
} else {
  console.warn('src-tauri/Cargo.lock not found; skipping Cargo.lock version sync.');
}

const nsisHooksPath = path.join(rootDir, 'src-tauri', 'nsis-hooks.nsh');
if (fs.existsSync(nsisHooksPath)) {
  const replaced = fs.readFileSync(nsisHooksPath, 'utf8').replace(
    /Caption "以苒纪 v[^"]*"/,
    `Caption "以苒纪 v${version}"`
  );
  fs.writeFileSync(nsisHooksPath, replaced);
} else {
  console.warn('src-tauri/nsis-hooks.nsh not found; skipping NSIS hooks version sync.');
}

// 从 CHANGELOG 当前版本一节生成客户端专用的更新说明（单版本、结构化、体积小），
// 供更新弹窗直接渲染，避免在运行时拉取并解析会持续变大的 CHANGELOG.md。
//
// 找不到当前版本小节时不做静默跳过（否则会沿用旧版本说明），而是写入带
// fallback 标记的兜底内容，并在控制台醒目警告，提醒补全 CHANGELOG 后重跑。
const FALLBACK_NOTES_TEXT = '本次未写或未读取到更新内容。';
const changelogPath = path.join(rootDir, 'CHANGELOG.md');
const releaseNotesPath = path.join(rootDir, 'release-notes.json');

let releaseNotes = null;
let fallbackReason = '';

if (fs.existsSync(changelogPath)) {
  const body = readChangelogSection(fs.readFileSync(changelogPath, 'utf8'), version);
  const sections = body ? parseChangelogSections(body) : [];
  if (!body) {
    fallbackReason = `CHANGELOG.md 中没有 "## v${version}" 小节`;
  } else if (sections.length === 0) {
    fallbackReason = `CHANGELOG.md 的 "## v${version}" 小节没有可解析的 "### 分类" 与 "- 条目"`;
  } else {
    releaseNotes = { version, sections };
  }
} else {
  fallbackReason = 'CHANGELOG.md 不存在';
}

if (!releaseNotes) {
  releaseNotes = {
    version,
    fallback: true,
    sections: [{ title: '更新内容', items: [FALLBACK_NOTES_TEXT] }],
  };
}

const notesContent = `${JSON.stringify(releaseNotes, null, 2)}\n`;
const previousNotes = fs.existsSync(releaseNotesPath)
  ? fs.readFileSync(releaseNotesPath, 'utf8')
  : '';
if (previousNotes !== notesContent) {
  fs.writeFileSync(releaseNotesPath, notesContent);
}

if (fallbackReason) {
  console.warn('');
  console.warn('------------------------------------------------------------');
  console.warn(`[警告] ${fallbackReason}。`);
  console.warn(`[警告] 已生成兜底 release-notes.json：“${FALLBACK_NOTES_TEXT}”`);
  console.warn('[警告] 请补全 CHANGELOG.md 的当前版本小节后，重新运行 npm run sync-version。');
  console.warn('------------------------------------------------------------');
  console.warn('');
} else {
  console.log(`Generated release-notes.json for ${version}.`);
}

console.log(`Synced app version to ${version}.`);