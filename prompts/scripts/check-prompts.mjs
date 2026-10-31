import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const checked = [];

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'scripts' ? [] : walk(p);
    return e.name.endsWith('.md') ? [p] : [];
  });
}

function readFrontmatter(text, file) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) {
    problems.push(`${file}: 缺少 frontmatter`);
    return {};
  }
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) fm[kv[1]] = kv[2].trim();
  }
  return fm;
}

const files = walk(root).filter((f) => path.basename(f) !== 'README.md');

for (const abs of files) {
  const rel = path.relative(root, abs).replace(/\\/g, '/');
  const text = fs.readFileSync(abs, 'utf8');
  const fm = readFrontmatter(text, rel);

  for (const key of ['id', 'title']) {
    if (!fm[key]) problems.push(`${rel}: frontmatter 缺 ${key}`);
  }

  const isShared = fm.kind === 'shared';
  if (!isShared) {
    for (const key of ['call', 'stream', 'temperature', 'output']) {
      if (!fm[key]) problems.push(`${rel}: frontmatter 缺 ${key}`);
    }
  }

  // 变量声明与使用一致
  if (!isShared) {
    const varSection = text.split(/^## 变量\r?\n/m)[1]?.split(/^## /m)[0] ?? '';
    const declared = new Set([...varSection.matchAll(/`\{\{(\w+)\}\}`/g)].map((m) => m[1]));
    const used = new Set([...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]));
    for (const v of used) if (!declared.has(v)) problems.push(`${rel}: 未声明变量 {{${v}}}`);
    for (const v of declared) if (!used.has(v)) problems.push(`${rel}: 声明未使用 {{${v}}}`);
  }

  // JSON 示例可解析
  for (const m of text.matchAll(/```json\r?\n([\s\S]*?)```/g)) {
    try {
      JSON.parse(m[1]);
    } catch (e) {
      problems.push(`${rel}: JSON 示例无法解析 → ${e.message}`);
    }
  }

  checked.push(rel);
}

// README 索引与实际文件一致
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
for (const link of readme.matchAll(/\]\(([a-z0-9/_\-]+\.md)\)/g)) {
  const target = path.join(root, link[1]);
  if (!fs.existsSync(target)) problems.push(`README.md: 索引指向不存在的文件 ${link[1]}`);
}

console.log(`checked ${checked.length} prompt files`);
if (problems.length === 0) {
  console.log('OK: 0 problem');
} else {
  console.log(`FOUND ${problems.length} problem(s):`);
  for (const p of problems) console.log(' - ' + p);
  process.exitCode = 1;
}
