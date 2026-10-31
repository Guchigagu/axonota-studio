// 生成 Tauri 所需图标（无第三方依赖）：深底圆角 + 六节点星图
// 几何构型：正六边形（顶点朝上）+ 三条过圆心的对径线 + 六个顶点圆点
// 16px 去掉圆点只留骨架；24px 起保留圆点
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "apps/desktop/src-tauri/icons");
mkdirSync(outDir, { recursive: true });

const GRID = 48;
const BG = [0x14, 0x15, 0x17];
const INK = [0xff, 0xff, 0xff];
const ACCENT = [0x6b, 0x93, 0xff];

/** 圆角矩形内部 */
function inRoundRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  const dx = x - cx, dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

/** 点到线段的距离 */
function segDist(px, py, a, b) {
  const vx = b[0] - a[0], vy = b[1] - a[1];
  const wx = px - a[0], wy = py - a[1];
  const len = vx * vx + vy * vy || 1;
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / len));
  const dx = px - (a[0] + t * vx), dy = py - (a[1] + t * vy);
  return Math.hypot(dx, dy);
}

// ---------------- 几何骨架：正六边形，顶点朝上（0° 在正上方）
const R = 14.6;                       // 顶点半径（48 网格）
const HALF = R / 2;
const SIDE = R * 0.8660254;           // R * cos30°
const V = [
  [24, 24 - R],                       // 上
  [24 + SIDE, 24 - HALF],             // 右上
  [24 + SIDE, 24 + HALF],             // 右下
  [24, 24 + R],                       // 下
  [24 - SIDE, 24 + HALF],             // 左下
  [24 - SIDE, 24 - HALF],             // 左上
];
const hexEdges = V.map((p, i) => [p, V[(i + 1) % 6]]);
const spokes = [[V[0], V[3]], [V[1], V[4]], [V[2], V[5]]];

// 大尺寸档（>=48px）
const MAIN = { edges: hexEdges, ew: 2.8, spokes, sw: 1.8, dots: V, r: 2.5 };
// 32px：线略加粗，保证边缘不碎
const MAIN_MID = { ...MAIN, ew: 3.6, sw: 2.2, r: 2.7 };
// 24px：粗到能立住，圆点缩小避免糊成一团
const SMALL = { edges: hexEdges, ew: 4.6, spokes, sw: 3.0, dots: V, r: 3.2 };
// 16px：只留六边形 + 三条对径，圆点在这个尺寸会糊
const TINY = { edges: hexEdges, ew: 5.6, spokes, sw: 3.6, dots: [], r: 0 };

/** 绘制一帧 RGBA 像素 */
function draw(size) {
  const tier = size <= 16 ? TINY : size <= 24 ? SMALL : size <= 32 ? MAIN_MID : MAIN;
  const k = size / GRID;
  const ss = size <= 64 ? 4 : size <= 256 ? 3 : 2;
  const px = Buffer.alloc(size * size * 4, 0);
  const tile = { x0: 2.88, y0: 2.88, x1: 45.12, y1: 45.12, r: 9.12 };
  const near = (d, w) => d <= w / 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let ar = 0, ag = 0, ab = 0, aa = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const ux = (x + (sx + 0.5) / ss) / k;
          const uy = (y + (sy + 0.5) / ss) / k;
          let col = null;
          if (inRoundRect(ux, uy, tile.x0, tile.y0, tile.x1, tile.y1, tile.r)) {
            col = BG;
            let strokeCol = null;
            for (const s of tier.edges) {
              if (near(segDist(ux, uy, s[0], s[1]), tier.ew)) { strokeCol = INK; break; }
            }
            if (!strokeCol) {
              for (const s of tier.spokes) {
                if (near(segDist(ux, uy, s[0], s[1]), tier.sw)) { strokeCol = INK; break; }
              }
            }
            if (strokeCol) col = strokeCol;
            for (const d of tier.dots) {
              if (Math.hypot(ux - d[0], uy - d[1]) <= tier.r) { col = ACCENT; break; }
            }
          }
          if (col) {
            ar += col[0]; ag += col[1]; ab += col[2]; aa += 255;
          }
        }
      }
      const n = ss * ss;
      const cov = aa / (255 * n);
      if (cov === 0) continue;
      const i = (y * size + x) * 4;
      px[i] = Math.round(ar / n / cov);
      px[i + 1] = Math.round(ag / n / cov);
      px[i + 2] = Math.round(ab / n / cov);
      px[i + 3] = Math.round(aa / n);
    }
  }
  return px;
}

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function u32(v) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(v >>> 0);
  return b;
}
function chunk(type, data) {
  // PNG 的 length 字段只统计 data，不含 4 字节 type
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  return Buffer.concat([u32(data.length), body, u32(crc32(body))]);
}
function png(size) {
  const pixels = draw(size);
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** ICO 容器：多尺寸 PNG 条目（16/24/32/48/256） */
function ico(entries) {
  const n = entries.length;
  const header = Buffer.alloc(6 + 16 * n);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(n, 4);
  let offset = 6 + 16 * n;
  entries.forEach((e, i) => {
    const at = 6 + 16 * i;
    header[at] = e.size >= 256 ? 0 : e.size;
    header[at + 1] = e.size >= 256 ? 0 : e.size;
    header[at + 2] = 0;
    header[at + 3] = 0;
    header.writeUInt16LE(1, at + 4);
    header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(e.buf.length, at + 8);
    header.writeUInt32LE(offset, at + 12);
    offset += e.buf.length;
  });
  return Buffer.concat([header, ...entries.map((e) => e.buf)]);
}

const sizes = {
  "16x16.png": 16,
  "24x24.png": 24,
  "32x32.png": 32,
  "48x48.png": 48,
  "64x64.png": 64,
  "128x128.png": 128,
  "128x128@2x.png": 256,
  "icon.png": 512,
};
const made = {};
for (const [name, size] of Object.entries(sizes)) {
  made[size] = png(size);
  writeFileSync(join(outDir, name), made[size]);
  console.log("icon:", name, size, `(${size <= 24 ? "小尺寸档" : "大尺寸档"})`);
}
writeFileSync(
  join(outDir, "icon.ico"),
  ico([16, 24, 32, 48, 256].map((size) => ({ size, buf: made[size] }))),
);
console.log("icon: icon.ico (16/24/32/48/256)");
