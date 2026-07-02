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
fs.writeFileSync(
  cargoLockPath,
  replaceCargoLockAppVersion(fs.readFileSync(cargoLockPath, 'utf8'), version)
);

console.log(`Synced app version to ${version}.`);
