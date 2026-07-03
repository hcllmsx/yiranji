// 将 ok_data_level4.csv 转换为树形 JSON（省→市→县区→乡镇街道）
import fs from 'node:fs';
import path from 'node:path';

const inputPath = path.resolve(import.meta.dirname, '../_temp/ok_data_level3-4.csv/ok_data_level4.csv');
const outputPath = path.resolve(import.meta.dirname, '../src/data/china-regions.json');

const lines = fs.readFileSync(inputPath, 'utf8').split(/\r?\n/).filter(Boolean);

// 解析 CSV 行（处理引号内逗号）
function parseLine(line) {
  const fields = [];
  let current = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuote = !inQuote;
    } else if (c === ',' && !inQuote) {
      fields.push(current);
      current = '';
    } else {
      current += c;
    }
  }
  fields.push(current);
  return fields;
}

const records = [];
for (let i = 1; i < lines.length; i++) {
  const [id, pid, deep, name, , , ext_id, ext_name] = parseLine(lines[i]);
  records.push({
    id: Number(id),
    pid: Number(pid),
    deep: Number(deep),
    name: ext_name || name, // ext_name 带后缀如"北京市"、"东城区"、"某某街道"
  });
}

// 构建四级树：{省: {市: {县: [乡镇]}}}
const tree = {};
const provinces = records.filter(r => r.deep === 0);
const cities = records.filter(r => r.deep === 1);
const areas = records.filter(r => r.deep === 2);
const towns = records.filter(r => r.deep === 3);

// 用 Map 加速查找
const provinceById = new Map(provinces.map(p => [p.id, p]));
const cityById = new Map(cities.map(c => [c.id, c]));
const areaById = new Map(areas.map(a => [a.id, a]));

for (const p of provinces) {
  tree[p.name] = {};
}

for (const c of cities) {
  const p = provinceById.get(c.pid);
  if (p && tree[p.name]) {
    tree[p.name][c.name] = {};
  }
}

for (const a of areas) {
  const c = cityById.get(a.pid);
  if (c) {
    const p = provinceById.get(c.pid);
    if (p && tree[p.name]?.[c.name]) {
      tree[p.name][c.name][a.name] = [];
    }
  }
}

for (const t of towns) {
  const a = areaById.get(t.pid);
  if (a) {
    const c = cityById.get(a.pid);
    if (c) {
      const p = provinceById.get(c.pid);
      if (p && tree[p.name]?.[c.name]?.[a.name]) {
        tree[p.name][c.name][a.name].push(t.name);
      }
    }
  }
}

// 确保输出目录存在
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(tree), 'utf8');

const sizeKB = Math.round(fs.statSync(outputPath).size / 1024);
console.log(`Generated: ${outputPath} (${sizeKB} KB)`);
console.log(`Provinces: ${Object.keys(tree).length}`);
