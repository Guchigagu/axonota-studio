/** 导出用的轻量 Markdown → HTML 与打印排版（不引入额外依赖） */

export interface HtmlSection {
  title: string;
  level: number;
  body: string;
  highlights?: Array<{ text: string }>;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** 行内标记：粗体、斜体、行内代码、链接；公式原样保留（打印稿可读即可） */
function inline(s: string): string {
  let out = esc(s);
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  return out;
}

/** 够用的 Markdown 渲染：标题、列表、引用、代码块、表格、段落 */
export function mdToHtml(md: string): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  const flushParagraph = (buf: string[]) => {
    if (!buf.length) return;
    out.push(`<p>${inline(buf.join(" "))}</p>`);
    buf.length = 0;
  };
  const para: string[] = [];
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      flushParagraph(para);
      const lang = line.slice(3).trim();
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]);
      i++;
      out.push(`<pre><code data-lang="${esc(lang)}">${esc(code.join("\n"))}</code></pre>`);
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushParagraph(para);
      const lv = h[1].length;
      out.push(`<h${lv}>${inline(h[2])}</h${lv}>`);
      i++;
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      flushParagraph(para);
      const quote: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ""));
      out.push(`<blockquote>${inline(quote.join(" "))}</blockquote>`);
      continue;
    }
    if (/^\s*(\||[-*_]\s*){3,}/.test(line) && /^\s*-/.test(line) && !line.includes("|")) {
      i++;
      continue;
    }
    if (/^\s*\|/.test(line)) {
      flushParagraph(para);
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        const cells = lines[i]
          .trim()
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      if (rows.length) {
        const [head, ...body] = rows;
        out.push(
          `<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${body
            .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`)
            .join("")}</tbody></table>`,
        );
      }
      continue;
    }
    if (/^\s*(?:[-*]|\d+\.)\s+/.test(line)) {
      flushParagraph(para);
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*(?:[-*]|\d+\.)\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*(?:[-*]|\d+\.)\s+/, ""));
        i++;
      }
      const tag = ordered ? "ol" : "ul";
      out.push(`<${tag}>${items.map((t) => `<li>${inline(t)}</li>`).join("")}</${tag}>`);
      continue;
    }
    if (!line.trim()) {
      flushParagraph(para);
      i++;
      continue;
    }
    para.push(line.trim());
    i++;
  }
  flushParagraph(para);
  return out.join("\n");
}

/** 把高亮原文在 HTML 文本里标注出来（只标第一次出现，避免刷屏） */
function applyHighlights(html: string, highlights?: Array<{ text: string }>): string {
  let out = html;
  for (const h of highlights ?? []) {
    const target = esc(h.text.trim());
    if (!target) continue;
    const idx = out.indexOf(target);
    if (idx === -1) continue;
    out = `${out.slice(0, idx)}<mark class="hl">${target}</mark>${out.slice(idx + target.length)}`;
  }
  return out;
}

export function buildPrintHtml(input: {
  title: string;
  scope?: string;
  topic?: string;
  generatedAt?: string;
  sections: HtmlSection[];
  highlights?: Array<{ text: string }>;
  lang?: "zh" | "en";
}): string {
  const en = input.lang === "en";
  const toc = input.sections
    .filter((s) => s.level <= 2)
    .map((s) => `<li class="l${s.level}">${esc(s.title)}</li>`)
    .join("");
  const body = input.sections
    .map((s) => {
      const cls = s.level === 1 ? ' class="chapter"' : "";
      const html = applyHighlights(mdToHtml(s.body || (en ? "(not generated)" : "（未生成）")), s.highlights);
      return `<section${cls}><h${Math.min(3, s.level + 1)}>${esc(s.title)}</h${Math.min(3, s.level + 1)}>${html}</section>`;
    })
    .join("\n");
  const allHighlights = input.highlights ?? [];
  const notes = allHighlights.length
    ? `<section class="notes"><h2>${en ? "Highlights" : "我的高亮"}</h2><ol>${allHighlights
        .map((h) => `<li><q>${esc(h.text)}</q></li>`)
        .join("")}</ol></section>`
    : "";
  return `<!doctype html>
<html lang="${en ? "en" : "zh"}"><head><meta charset="utf-8" />
<title>${esc(input.title)}</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body { font-family: "Noto Serif SC", "Songti SC", "SimSun", Georgia, serif; color: #1c1c1c; line-height: 1.75; font-size: 11.5pt; margin: 0; }
  .cover { padding: 20mm 0 10mm; border-bottom: 1.5pt solid #1c1c1c; margin-bottom: 8mm; }
  .cover h1 { font-size: 24pt; margin: 0 0 4mm; letter-spacing: .5pt; }
  .cover .meta { color: #666; font-size: 10pt; }
  .cover .scope { margin-top: 6mm; padding: 4mm 5mm; background: #f6f5f2; border-left: 2.5pt solid #1c1c1c; font-size: 10.5pt; }
  .toc { margin: 6mm 0 10mm; }
  .toc h2 { font-size: 13pt; margin: 0 0 3mm; }
  .toc ol { list-style: none; padding: 0; margin: 0; font-size: 10.5pt; }
  .toc li { padding: 1mm 0; border-bottom: .4pt dotted #ccc; }
  .toc .l2 { padding-left: 8mm; color: #444; }
  section.chapter { page-break-before: always; }
  h2, h3, h4 { font-family: "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif; color: #111; }
  h2 { font-size: 17pt; margin: 0 0 4mm; border-bottom: .8pt solid #333; padding-bottom: 2mm; }
  h3 { font-size: 13.5pt; margin: 7mm 0 2mm; }
  h4 { font-size: 12pt; margin: 5mm 0 1.5mm; }
  p { margin: 0 0 3mm; text-align: justify; }
  ul, ol { margin: 0 0 3mm; padding-left: 6mm; }
  li { margin: 1mm 0; }
  blockquote { margin: 3mm 0; padding: 2mm 4mm; border-left: 2pt solid #999; color: #444; background: #faf9f7; }
  code { font-family: "JetBrains Mono", Consolas, monospace; font-size: 9.5pt; background: #f1f0ed; padding: 0 1mm; }
  pre { background: #f6f5f2; padding: 3mm; overflow-wrap: anywhere; white-space: pre-wrap; page-break-inside: avoid; }
  table { width: 100%; border-collapse: collapse; margin: 3mm 0; font-size: 10pt; }
  th, td { border: .5pt solid #bbb; padding: 1.5mm 2mm; text-align: left; }
  th { background: #f2f0ec; }
  mark.hl { background: #fbe7a1; padding: 0 .5mm; }
  .notes { page-break-before: always; }
  .notes q { quotes: "「" "」"; }
  .notes li { margin: 2mm 0; }
  @media print { .no-print { display: none; } }
</style></head>
<body>
  <div class="cover">
    <h1>${esc(input.title)}</h1>
    <div class="meta">${esc(input.topic ?? "")}${input.topic ? " · " : ""}${esc(input.generatedAt ?? "")}</div>
    ${input.scope ? `<div class="scope">${esc(input.scope)}</div>` : ""}
  </div>
  ${toc ? `<div class="toc"><h2>${en ? "Contents" : "目录"}</h2><ol>${toc}</ol></div>` : ""}
  ${body}
  ${notes}
</body></html>`;
}

/** 在应用内用隐藏 iframe 调系统打印；用户可选择「另存为 PDF」 */
export function printHtml(html: string, lang: "zh" | "en" = "zh"): void {
  const frame = document.createElement("iframe");
  frame.style.position = "fixed";
  frame.style.right = "0";
  frame.style.bottom = "0";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";
  document.body.appendChild(frame);
  const win = frame.contentWindow;
  if (!win) throw new Error(lang === "en" ? "Could not create the print window." : "无法创建打印窗口");
  win.document.open();
  win.document.write(html);
  win.document.close();
  setTimeout(() => {
    try {
      win.focus();
      win.print();
    } finally {
      setTimeout(() => frame.remove(), 1000);
    }
  }, 350);
}
