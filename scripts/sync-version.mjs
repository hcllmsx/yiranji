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
const changelogPath = path.join(rootDir, 'CHANGELOG.md');
const releaseNotesPath = path.join(rootDir, 'release-notes.json');
if (fs.existsSync(changelogPath)) {
  const body = readChangelogSection(fs.readFileSync(changelogPath, 'utf8'), version);
  const sections = body ? parseChangelogSections(body) : [];

  if (sections.length > 0) {
    const content = `${JSON.stringify({ version, sections }, null, 2)}\n`;
    const previous = fs.existsSync(releaseNotesPath)
      ? fs.readFileSync(releaseNotesPath, 'utf8')
      : '';
    if (previous !== content) {
      fs.writeFileSync(releaseNotesPath, content);
    }
    console.log(`Generated release-notes.json for ${version}.`);
  } else {
    console.warn(`Skipped release-notes.json: no usable "## v${version}" section in CHANGELOG.md.`);
  }
} else {
  console.warn('CHANGELOG.md not found; skipping release-notes.json generation.');
}

console.log(`Synced app version to ${version}.`);