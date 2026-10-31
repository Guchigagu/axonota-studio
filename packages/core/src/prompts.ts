import { parseFrontMatter } from "./frontmatter";

export interface PromptSpec {
  /** frontmatter 的 id，例如 outline-notebook */
  id: string;
  /** 库内路径，例如 outline/01-notebook-outline.md */
  path: string;
  title: string;
  call?: string;
  stream: boolean;
  temperature: number;
  output: "json" | "markdown" | "text" | "messages";
  system: string;
  userTemplate: string;
  /** 「## 附加要求」下的补充约束，拼在系统提示词末尾 */
  appendix: string;
  /** 「## 输出 Schema」下的 JSON 结构示例；JSON 类提示词必须随系统提示词下发 */
  schema: string;
  variables: string[];
  isShared: boolean;
}

export interface PromptLibrary {
  files: Record<string, string>;
  byId: Map<string, PromptSpec>;
  byPath: Map<string, PromptSpec>;
  get(idOrPath: string): PromptSpec;
  raw(idOrPath: string): string;
  /** 取 shared 文件里某一节（A/B/C/D），用于按输出类型挑选契约 */
  sharedSection(name: string, section?: string): string;
}

function stripHeadings(text: string): string {
  return text
    .split("\n")
    .filter((line) => !line.startsWith("# "))
    .join("\n")
    .replace(/^\s+/g, "")
    .trim();
}

function fencedBlockAfter(text: string, heading: string): string {
  const idx = text.indexOf(heading);
  if (idx === -1) return "";
  const rest = text.slice(idx + heading.length);
  const m = rest.match(/```[a-zA-Z]*\n([\s\S]*?)```/);
  return m ? m[1].trim() : "";
}

function parseVariables(text: string): string[] {
  const set = new Set<string>();
  for (const m of text.matchAll(/^\| *`\{\{(\w+)\}\}` *\|/gm)) set.add(m[1]);
  for (const m of text.matchAll(/\{\{(\w+)\}\}/g)) set.add(m[1]);
  return [...set];
}

export function parsePromptFile(path: string, raw: string): PromptSpec {
  const { data, body } = parseFrontMatter(raw);
  return {
    id: String(data.id ?? path),
    path,
    title: String(data.title ?? path),
    call: data.call ? String(data.call) : undefined,
    stream: data.stream === true,
    temperature: typeof data.temperature === "number" ? data.temperature : 0.4,
    output: (data.output as PromptSpec["output"]) ?? "text",
    system: fencedBlockAfter(body, "## 系统提示词"),
    userTemplate: fencedBlockAfter(body, "## 用户消息模板"),
    appendix: fencedBlockAfter(body, "## 附加要求"),
    schema: fencedBlockAfter(body, "## 输出 Schema"),
    variables: parseVariables(body),
    isShared: String(data.kind ?? "") === "shared" || path.startsWith("shared/"),
  };
}

export function createPromptLibrary(files: Record<string, string>): PromptLibrary {
  const byId = new Map<string, PromptSpec>();
  const byPath = new Map<string, PromptSpec>();
  for (const [path, raw] of Object.entries(files)) {
    const spec = parsePromptFile(path, raw);
    byPath.set(path, spec);
    if (!spec.isShared) byId.set(spec.id, spec);
  }
  const resolve = (key: string): PromptSpec => {
    const spec = byId.get(key) ?? byPath.get(key) ?? byPath.get(`${key}.md`);
    if (!spec) throw new Error(`提示词不存在：${key}`);
    return spec;
  };
  const sharedSection = (name: string, section?: string): string => {
    const raw = files[`shared/${name}`] ?? "";
    if (!raw) return "";
    const body = parseFrontMatter(raw).body;
    if (!section) return stripHeadings(body);
    // 单字母小节（A/B/C/D）按「字母 + 点」匹配；其他按标题原文匹配
    const start = body.search(
      /^[A-Z]\./.test(section) ? new RegExp(`^## ${section}\\.`, "m") : new RegExp(`^## ${section}`, "m"),
    );
    if (start === -1) return stripHeadings(body);
    const next = body.slice(start + 3).search(/^## /m);
    const slice = next === -1 ? body.slice(start) : body.slice(start, start + 3 + next);
    return stripHeadings(slice);
  };
  return {
    files,
    byId,
    byPath,
    get: resolve,
    raw: (key) => resolve(key) && (files[resolve(key).path] ?? ""),
    sharedSection,
  };
}

export function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? "");
}

export interface AssembleOptions {
  vars?: Record<string, string>;
  /** 需要的 shared 文件（不含扩展名），默认 tone */
  shared?: string[];
  /** 输出契约小节：A 正文 / B 组件 / C 流式 / D 长度 */
  contractSections?: string[];
  /** 是否附上来源规则（shared/03-sources） */
  withSources?: boolean;
  /** 用户消息尾部追加的上下文资料块 */
  context?: string;
  /** 输出语言：英文界面时追加一条“全部输出用英文”的硬约束 */
  language?: "zh" | "en";
}

export function assemble(
  lib: PromptLibrary,
  key: string,
  opts: AssembleOptions = {},
): { system: string; user: string; spec: PromptSpec } {
  const spec = lib.get(key);
  const baseShared = new Set(opts.shared ?? ["01-tone"]);
  const parts: string[] = [];

  const tone = lib.sharedSection("01-tone");
  if (baseShared.has("01-tone") && tone) parts.push(tone);

  if (spec.system) parts.push(spec.system);
  if (spec.appendix) parts.push(spec.appendix);

  for (const sec of opts.contractSections ?? []) {
    const chunk = lib.sharedSection("02-output-contract", sec);
    if (chunk) parts.push(chunk);
  }

  if (opts.withSources) {
    // JSON 输出只给 sources 结构；「正文第一行写……」那套是给 Markdown 的，会诱导模型在 JSON 前后写说明
    const chunk =
      spec.output === "json" ? lib.sharedSection("03-sources", "sources 数组结构") : lib.sharedSection("03-sources");
    if (chunk) parts.push(chunk);
  }

  // JSON 类提示词必须把本提示词自己的结构示例放到最后：只给类型契约不够，
  // 模型不知道字段名就会自由发挥，最后解析不出来。
  if (spec.output === "json" && spec.schema) {
    parts.push(`输出必须严格符合下面这个 JSON 结构（字段名原样照抄，不要增删顶层字段）：\n\n${spec.schema}`);
  }

  if (opts.language === "en") {
    parts.push(
      "## Output language\n" +
        "Write every user-facing string in natural English: titles, headings, body text, list items, summaries, quiz questions and options, component labels and source titles. " +
        "Keep JSON field names, ids and fixed enum values exactly as specified. Do not output Chinese unless the user explicitly asks for it.",
    );
  }

  const vars = opts.vars ?? {};
  const user = fillTemplate(spec.userTemplate, vars) + (opts.context ? `\n\n${opts.context}` : "");

  return { system: parts.join("\n\n"), user, spec };
}

/** 装配随层继承的资料块，供 shared/04-context 的规则使用 */
export function contextBlock(input: {
  rootFiles?: Array<{ name: string; text: string }>;
  nodeAttachments?: Array<{ name: string; text: string }>;
  ancestorAttachments?: Array<{ name: string; text: string }>;
  webPages?: Array<{ title: string; url: string; text: string }>;
  pageRefs?: Array<{ title: string; text: string }>;
  uploads?: Array<{ name: string; text: string }>;
}): string {
  const chunks: string[] = [];
  const push = (label: string, items: Array<{ name?: string; title?: string; text: string }> | undefined) => {
    if (!items?.length) return;
    chunks.push(`## ${label}`);
    for (const it of items) {
      const name = it.name ?? it.title ?? "未命名";
      chunks.push(`<<<${name}>>>\n${it.text}\n<<</${name}>>>`);
    }
  };
  push("根文件", input.rootFiles);
  push("本次上传", input.uploads);
  push("本节附件", input.nodeAttachments);
  push("祖先层级附件", input.ancestorAttachments);
  if (input.webPages?.length) {
    chunks.push("## 网络检索结果");
    input.webPages.forEach((p, i) => {
      chunks.push(`[[${i + 1}]] ${p.title} — ${p.url}\n${p.text}`);
    });
  }
  push("笔记本内相关页", input.pageRefs);
  return chunks.join("\n\n");
}
