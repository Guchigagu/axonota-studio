import type { ModelConfig, Node, Notebook, OutlineChapter, OutlineDraft, Settings, SourceRef, StylePreset } from "./types";
import type { Vault } from "./vault";
import { chatComplete, chatStream, extractJson, type ChatMessage, type FetchLike } from "./ai";
import { assemble, contextBlock, type PromptLibrary } from "./prompts";
import { newId } from "./ids";

export const STYLE_PRESETS: StylePreset[] = [
  {
    id: "feynman",
    name: "费曼讲解",
    description: "用大白话讲：先给直觉与例子，再补定义；每段读完都能用自己的话复述。",
  },
  {
    id: "steps",
    name: "步骤化",
    description: "按可执行步骤组织：每步写清输入、动作、预期结果，能照着做。",
  },
  {
    id: "exam",
    name: "考点直给",
    description: "围绕会被考/会被问的点：先给结论与判定标准，再给易错处，少铺垫。",
  },
  {
    id: "analogy",
    name: "类比对照",
    description: "用熟悉的事物类比，并明确指出类比的边界在哪里失效。",
  },
];

export interface WebPage {
  title: string;
  url: string;
  text: string;
}

/** 把结构化大纲转成可编辑的缩进文本：章顶格、节缩进两格，goal 跟在“——”后 */
export function formatOutlineText(draft: OutlineDraft): string {
  return draft.chapters
    .map((ch, i) => {
      const head = `${i + 1}. ${ch.title || `第 ${i + 1} 章`}${ch.goal ? ` —— ${ch.goal}` : ""}`;
      const kids = ch.sections.map(
        (sec, j) =>
          `  ${i + 1}.${j + 1} ${sec.title || `第 ${j + 1} 节`}${sec.goal ? ` —— ${sec.goal}` : ""}`,
      );
      return [head, ...kids].join("\n");
    })
    .join("\n");
}

/** 解析用户编辑后的大纲文本。按缩进分章与节，编号与 goal 都可改；至少要有章。 */
export function parseOutlineText(text: string): OutlineDraft {
  const chapters: OutlineChapter[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    if (/^\s*大纲\s*[：:]/.test(raw)) continue;
    const indented = /^[\t ]+/.test(raw);
    const line = raw.trim().replace(/^[-•·]\s*/, "");
    const m = line.match(/^(\d+(?:\.\d+)*)\s*[.、)]?\s*(.*)$/);
    const body = (m ? m[2] : line).trim();
    if (!body) continue;
    const [title, ...rest] = body.split(/\s*——\s*/);
    const goal = rest.join("——").trim() || undefined;
    if (!title.trim()) continue;
    // 缩进或“1.1”这类二级编号都算小节，用户手改掉缩进时也不会把节误判成章
    const isSection = chapters.length > 0 && (indented || (m?.[1]?.includes(".") ?? false));
    if (isSection) {
      const ch = chapters[chapters.length - 1];
      ch.sections.push({ id: `${chapters.length}.${ch.sections.length + 1}`, title: title.trim(), goal });
    } else {
      chapters.push({
        id: String(chapters.length + 1).padStart(2, "0"),
        title: title.trim(),
        goal,
        sections: [],
      });
    }
  }
  return { type: "outline", chapters };
}


export interface WebSearchPort {
  search(query: string, limit?: number): Promise<WebPage[]>;
}

export interface AiDeps {
  fetchFn: FetchLike;
  lib: PromptLibrary;
  model: ModelConfig;
  webSearch?: WebSearchPort;
  /** 输出语言：英文界面时所有生成内容用英文 */
  language?: "zh" | "en";
}

export type GenEvent =
  | { type: "meta"; data: Record<string, unknown> }
  | { type: "delta"; text: string }
  | { type: "done"; cites: number[] };

/** 从流里剥离 <meta>{...}</meta>，只把正文交给渲染器 */
export class StreamParser {
  private buffer = "";
  private citeIds: number[] = [];

  push(chunk: string): GenEvent[] {
    this.buffer += chunk;
    const events: GenEvent[] = [];
    let visibleStart = 0;
    while (true) {
      const open = this.buffer.indexOf("<meta>", visibleStart);
      if (open === -1) break;
      const close = this.buffer.indexOf("</meta>", open);
      if (close === -1) break;
      const text = this.buffer.slice(visibleStart, open);
      if (text) events.push({ type: "delta", text });
      try {
        const data = JSON.parse(this.buffer.slice(open + 6, close)) as Record<string, unknown>;
        if (Array.isArray(data.cites)) {
          this.citeIds = (data.cites as number[]).filter((n) => typeof n === "number");
        }
        events.push({ type: "meta", data });
      } catch {
        // 坏 meta 直接丢弃
      }
      visibleStart = close + 7;
    }
    if (visibleStart > 0) {
      this.buffer = this.buffer.slice(visibleStart);
      // 保留可能被截断的 <meta> 前缀
      const partial = this.buffer.indexOf("<");
      if (partial === -1) {
        const pending = this.buffer;
        this.buffer = "";
        if (pending) events.push({ type: "delta", text: pending });
      } else if (partial > 0) {
        const pending = this.buffer.slice(0, partial);
        this.buffer = this.buffer.slice(partial);
        if (pending) events.push({ type: "delta", text: pending });
      }
      return events;
    }
    if (this.buffer.includes("<")) {
      const idx = this.buffer.indexOf("<");
      const pending = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx);
      if (pending) events.push({ type: "delta", text: pending });
    } else {
      const pending = this.buffer;
      this.buffer = "";
      if (pending) events.push({ type: "delta", text: pending });
    }
    return events;
  }

  flush(): GenEvent[] {
    if (!this.buffer) return [];
    const text = this.buffer;
    this.buffer = "";
    return [{ type: "delta", text }];
  }

  get cites(): number[] {
    return this.citeIds;
  }
}

export function pickModel(settings: Settings, preferredId?: string): ModelConfig {
  const model = settings.models.find((m) => m.id === preferredId) ?? settings.models.find((m) => m.id === settings.defaultModelId) ?? settings.models[0];
  if (!model) throw new Error("尚未添加模型。请到「设置 → 模型」添加一个 OpenAI 兼容接口后再生成。");
  return model;
}

/** 把风格 id 变成给模型看的完整描述：预设展开为「名称（讲法）」，自定义原样 */
export function styleText(id: string): string {
  if (id.startsWith("custom:")) return id.slice(7).trim() || "自由发挥";
  const preset = STYLE_PRESETS.find((s) => s.id === id);
  return preset ? `${preset.name}（${preset.description}）` : id;
}

export function styleLabel(nb: Notebook): string {
  return styleText(nb.style);
}

function nodePath(nb: Notebook, nodeId: string): string {
  const byId = new Map(nb.nodes.map((n) => [n.id, n]));
  const parts: string[] = [];
  let cur = byId.get(nodeId);
  while (cur) {
    parts.unshift(cur.title);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return parts.join(" › ");
}

function siblings(nb: Notebook, node: Node): Node[] {
  return nb.nodes.filter((n) => n.parentId === node.parentId && n.id !== node.id).sort((a, b) => a.order - b.order);
}

const TEXT_EXT = new Set(["md", "txt", "csv", "json", "yaml", "yml", "html", "htm", "ts", "js", "tsx", "jsx", "py", "java", "c", "cpp", "h", "rs", "go", "sql", "tex", "log"]);

function readAttachments(vault: Vault, list: Array<{ name: string; path: string }>, budget: number) {
  return (async () => {
    const out: Array<{ name: string; text: string }> = [];
    let used = 0;
    for (const a of list) {
      const ext = a.name.split(".").pop()?.toLowerCase() ?? "";
      if (!TEXT_EXT.has(ext)) {
        out.push({ name: a.name, text: "（二进制附件，未纳入文本上下文）" });
        continue;
      }
      try {
        const raw = await vault.getRawText(a.path);
        const room = Math.max(0, budget - used);
        const text = raw.slice(0, Math.min(room, 4000));
        used += text.length;
        out.push({ name: a.name, text });
        if (used >= budget) break;
      } catch {
        out.push({ name: a.name, text: "（读取失败）" });
      }
    }
    return out;
  })();
}

export interface OutlineInput {
  topic: string;
  requirement?: string;
  style: string;
  rootFiles?: Array<{ name: string; text: string }>;
  webSearch?: boolean;
}

/** 模型偶尔会用 name/section 之类字段名代替 title，这里统一收敛成 OutlineDraft 结构。 */
function pickText(...vals: unknown[]): string | undefined {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

function normalizeOutlineDraft(raw: unknown): OutlineDraft {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const rawChapters = Array.isArray(obj.chapters)
    ? obj.chapters
    : Array.isArray(obj.outline)
      ? obj.outline
      : [];
  const chapters: OutlineChapter[] = (rawChapters as unknown[]).map((item, i) => {
    const ch = (item ?? {}) as Record<string, unknown>;
    const rawSections = Array.isArray(ch.sections)
      ? ch.sections
      : Array.isArray(ch.children)
        ? ch.children
        : [];
    const sections: OutlineChapter["sections"] = (rawSections as unknown[]).map((child, j) => {
      const sec = (child ?? {}) as Record<string, unknown>;
      return {
        id: pickText(sec.id) ?? `${i + 1}.${j + 1}`,
        title:
          pickText(sec.title, sec.name, sec.section, sec.section_title, sec.heading, sec.label) ??
          `第 ${j + 1} 节`,
        goal: pickText(sec.goal, sec.objective, sec.outcome, sec.description, sec.desc, sec.summary),
      };
    });
    return {
      id: pickText(ch.id) ?? String(i + 1).padStart(2, "0"),
      title:
        pickText(ch.title, ch.name, ch.chapter, ch.chapter_title, ch.heading, ch.label) ?? `第 ${i + 1} 章`,
      goal: pickText(ch.goal, ch.objective, ch.outcome, ch.description, ch.desc, ch.summary),
      sections,
    };
  });
  return {
    type: "outline",
    assumption: pickText(obj.assumption),
    scope_one_line: pickText(obj.scope_one_line, obj.scope),
    chapters,
    coverage_gaps: Array.isArray(obj.coverage_gaps) ? (obj.coverage_gaps as string[]) : undefined,
    sources: Array.isArray(obj.sources) ? (obj.sources as Array<{ title: string; url?: string }>) : undefined,
  };
}

export async function generateOutline(deps: AiDeps, input: OutlineInput): Promise<OutlineDraft> {
  const rootExcerpt = (input.rootFiles ?? []).map((f) => `<<<${f.name}>>>\n${f.text.slice(0, 3000)}\n<<</${f.name}>>>`).join("\n\n");
  const { system, user } = assemble(deps.lib, "outline-notebook", {
    language: deps.language,
    vars: {
      topic: input.topic,
      requirement: input.requirement ?? "",
      style: styleText(input.style),
      has_root_file: input.rootFiles?.length ? "是" : "否",
      root_excerpt: rootExcerpt,
      today: new Date().toISOString().slice(0, 10),
    },
    // 大纲有自己的结构，不要套组件契约（B 段的顶层字段是 items，对不上目录树）
    contractSections: [],
    withSources: input.webSearch,
  });
  const messages: ChatMessage[] = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
  let truncated = false;
  const ask = (temperature: number, maxTokens: number) =>
    chatComplete(deps.fetchFn, deps.model, messages, {
      temperature,
      maxTokens,
      onFinish: (reason) => {
        truncated = reason === "length";
      },
    });
  const raw = await ask(0.4, 4096);
  try {
    const draft = normalizeOutlineDraft(extractJson<OutlineDraft>(raw));
    if (draft.chapters.length) return draft;
  } catch {
    // 第一次没解析出来，下面重试
  }
  // 被 max_tokens 截断时放宽上限再试，否则只是降低温度重发
  const retry = await ask(0.2, truncated ? 8192 : 4096);
  const draft = normalizeOutlineDraft(extractJson<OutlineDraft>(retry));
  if (!draft.chapters.length) throw new Error("模型没有给出章节目录，请重试或换一个模型");
  return draft;
}

export async function suggestTitles(deps: AiDeps, draft: OutlineDraft): Promise<string[]> {
  const { system, user } = assemble(deps.lib, "ops-title-suggest", {
    language: deps.language,
    vars: {
      chapters: draft.chapters.map((c) => `${c.title}：${c.goal ?? ""}`).join("\n"),
      scope_one_line: draft.scope_one_line ?? "",
    },
    contractSections: [],
  });
  try {
    const raw = await chatComplete(deps.fetchFn, deps.model, [
      { role: "system", content: system },
      { role: "user", content: user },
    ], { temperature: 0.6, maxTokens: 200 });
    const parsed = extractJson<{ titles?: string[] }>(raw);
    return (parsed.titles ?? []).slice(0, 3);
  } catch {
    return [];
  }
}

export interface NodeContext {
  rootFiles: Array<{ name: string; text: string }>;
  nodeAttachments: Array<{ name: string; text: string }>;
  ancestorAttachments: Array<{ name: string; text: string }>;
  pages: Array<{ id: string; title: string; text: string }>;
}

export async function collectNodeContext(vault: Vault, nb: Notebook, nodeId: string): Promise<NodeContext> {
  const byId = new Map(nb.nodes.map((n) => [n.id, n]));
  const node = byId.get(nodeId);
  const chain: Node[] = [];
  let cur: Node | undefined = node;
  while (cur) {
    chain.unshift(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  const root = nb.nodes.find((n) => n.kind === "root");
  const rootFiles = await readAttachments(vault, (root?.attachments ?? []).map((a) => ({ name: a.name, path: a.path })), 6000);
  const nodeAttachments = await readAttachments(vault, (node?.attachments ?? []).map((a) => ({ name: a.name, path: a.path })), 6000);
  const ancestorList = chain
    .slice(0, -1)
    .filter((n) => n.kind !== "root")
    .flatMap((n) => (n.attachments ?? []).filter((a) => a.inherit).map((a) => ({ name: a.name, path: a.path })));
  const ancestorAttachments = await readAttachments(vault, ancestorList, 6000);
  const pages: Array<{ id: string; title: string; text: string }> = [];
  const chapter = chain.filter((n) => n.kind === "chapter").pop();
  if (chapter) {
    const siblingsDone = nb.nodes
      .filter((n) => n.parentId === chapter.id && n.status === "done")
      .sort((a, b) => a.order - b.order)
      .slice(0, 6);
    for (const s of siblingsDone) {
      const body = await vault.getNodeBody(nb.id, s.id);
      if (body) pages.push({ id: s.id, title: nodePath(nb, s.id), text: body.slice(0, 1200) });
    }
  }
  return { rootFiles, nodeAttachments, ancestorAttachments, pages };
}

export async function* streamNodeContent(
  vault: Vault,
  nb: Notebook,
  nodeId: string,
  deps: AiDeps,
  opts: { requirement?: string; signal?: AbortSignal; webPages?: WebPage[] } = {},
): AsyncGenerator<GenEvent> {
  const node = nb.nodes.find((n) => n.id === nodeId);
  if (!node) throw new Error("节点不存在");
  const ctx = await collectNodeContext(vault, nb, nodeId);
  const ctxText = contextBlock(ctx);
  const built = (() => {
    if (node.kind === "root") {
      const chapters = nb.nodes
        .filter((n) => n.kind === "chapter")
        .sort((a, b) => a.order - b.order)
        .map((c, i) => `${i + 1}. ${c.title} — ${c.goal ?? ""}（${nb.nodes.filter((s) => s.parentId === c.id).length} 节）`)
        .join("\n");
      return assemble(deps.lib, "content-root-overview", {
        language: deps.language,
        vars: {
          domain: node.title,
          requirement: opts.requirement ?? nb.assumption ?? "",
          chapters,
          has_root_file: ctx.rootFiles.length ? "是" : "否",
        },
        contractSections: ["A", "C"],
        withSources: nb.webSearch,
        context: ctxText,
      });
    }
    if (node.kind === "chapter") {
      const sections = nb.nodes
        .filter((n) => n.parentId === node.id)
        .sort((a, b) => a.order - b.order)
        .map((s, i) => `${i + 1}. ${s.title} — ${s.goal ?? ""}`)
        .join("\n");
      const prev = nb.nodes
        .filter((n) => n.parentId === node.parentId && n.kind === "chapter")
        .sort((a, b) => a.order - b.order)
        .filter((n) => n.order < node.order)
        .pop();
      return assemble(deps.lib, "content-chapter-overview", {
        language: deps.language,
        vars: {
          notebook_title: nb.title,
          chapter_title: node.title,
          chapter_goal: node.goal ?? "",
          sections,
          prev_chapter: prev ? `${prev.title} — ${prev.goal ?? ""}` : "",
        },
        contractSections: ["A", "C"],
        withSources: nb.webSearch,
        context: ctxText,
      });
    }
    return assemble(deps.lib, "content-section", {
      language: deps.language,
      vars: {
        notebook_title: nb.title,
        path: nodePath(nb, nodeId),
        section_title: node.title,
        section_goal: node.goal ?? "",
        sibling_titles: siblings(nb, node).map((s) => s.title).join("、"),
        style: styleLabel(nb),
      },
      contractSections: ["A", "C"],
      withSources: nb.webSearch,
      context: ctxText,
    });
  })();

  // 联网检索结果只作为“这次实际抓到的网页”拼进上下文，禁止模型据此编造别的链接
  const webContext = opts.webPages?.length
    ? `\n\n## 本次联网检索到的网页（只能引用这些，禁止编造 URL）\n${opts.webPages
        .map(
          (p, i) =>
            `[web:${i + 1}] ${p.title}\nURL: ${p.url}\n摘要：${p.text.replace(/\s+/g, " ").slice(0, 800)}`,
        )
        .join("\n\n")}`
    : "";

  const parser = new StreamParser();
  for await (const delta of chatStream(
    deps.fetchFn,
    deps.model,
    [
      { role: "system", content: built.system },
      { role: "user", content: built.user + webContext },
    ],
    { temperature: built.spec.temperature, signal: opts.signal },
  )) {
    for (const ev of parser.push(delta)) yield ev;
  }
  for (const ev of parser.flush()) yield ev;
  yield { type: "done", cites: parser.cites };
}

export interface ChatScope {
  mode: "chapter" | "book" | "auto";
  pages: Array<{ id: string; title: string; text: string }>;
  /** 对话作用域内可读的附件：根文件 / 本节附件 / 祖先「继承到下级」的附件 */
  rootFiles: Array<{ name: string; text: string }>;
  nodeAttachments: Array<{ name: string; text: string }>;
  ancestorAttachments: Array<{ name: string; text: string }>;
}

/** 对话也按节点作用域读附件，规则与 collectNodeContext 一致 */
async function chatAttachments(
  vault: Vault,
  nb: Notebook,
  nodeId: string | null,
): Promise<Pick<ChatScope, "rootFiles" | "nodeAttachments" | "ancestorAttachments">> {
  const byId = new Map(nb.nodes.map((n) => [n.id, n]));
  const node = nodeId ? byId.get(nodeId) : undefined;
  const chain: Node[] = [];
  let cur: Node | undefined = node;
  while (cur) {
    chain.unshift(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  const root = nb.nodes.find((n) => n.kind === "root");
  const rootFiles = await readAttachments(
    vault,
    (root?.attachments ?? []).map((a) => ({ name: a.name, path: a.path })),
    6000,
  );
  const nodeAttachments = await readAttachments(
    vault,
    (node?.attachments ?? []).map((a) => ({ name: a.name, path: a.path })),
    6000,
  );
  const ancestorList = chain
    .slice(0, -1)
    .filter((n) => n.kind !== "root")
    .flatMap((n) => (n.attachments ?? []).filter((a) => a.inherit).map((a) => ({ name: a.name, path: a.path })));
  const ancestorAttachments = await readAttachments(vault, ancestorList, 6000);
  return { rootFiles, nodeAttachments, ancestorAttachments };
}

export async function buildChatScope(
  vault: Vault,
  nb: Notebook,
  nodeId: string | null,
  mode: "chapter" | "book" | "auto",
): Promise<ChatScope> {
  const attachments = await chatAttachments(vault, nb, nodeId);
  // 组件页（闪卡/速查表）不是正文，不进对话上下文
  const done = nb.nodes.filter((n) => n.status === "done" && n.kind !== "root" && n.kind !== "page");
  let target = done;
  if (mode !== "book") {
    const byId = new Map(nb.nodes.map((n) => [n.id, n]));
    let cur = nodeId ? byId.get(nodeId) : undefined;
    if (cur?.kind === "root") cur = undefined;
    const chapter = cur ? findChapter(nb, cur.id) : undefined;
    if (chapter) {
      const ids = new Set<string>([chapter.id, ...nb.nodes.filter((n) => n.parentId === chapter.id).map((n) => n.id)]);
      target = done.filter((n) => ids.has(n.id) || ids.has(n.parentId ?? ""));
    }
  }
  const pages: Array<{ id: string; title: string; text: string }> = [];
  let budget = 14000;
  for (const n of target) {
    if (budget <= 0) break;
    const body = await vault.getNodeBody(nb.id, n.id);
    if (!body) continue;
    const text = body.slice(0, Math.min(1600, budget));
    budget -= text.length;
    pages.push({ id: n.id, title: nodePath(nb, n.id), text });
  }
  return { mode, pages, ...attachments };
}

function findChapter(nb: Notebook, nodeId: string): Node | undefined {
  const byId = new Map(nb.nodes.map((n) => [n.id, n]));
  let cur = byId.get(nodeId);
  while (cur) {
    if (cur.kind === "chapter") return cur;
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return undefined;
}

export async function* streamChat(
  deps: AiDeps,
  input: {
    nb: Notebook;
    scope: ChatScope;
    question: string;
    currentPath: string;
    selectedText?: string;
    /** 这条消息随手上传的文本资料 */
    uploads?: Array<{ name: string; text: string }>;
    /** 联网开启时这次实际抓到的网页 */
    webPages?: WebPage[];
    signal?: AbortSignal;
  },
): AsyncGenerator<GenEvent> {
  const baseContext = contextBlock({
    rootFiles: input.scope.rootFiles,
    nodeAttachments: input.scope.nodeAttachments,
    ancestorAttachments: input.scope.ancestorAttachments,
    pageRefs: input.scope.pages,
    uploads: input.uploads,
  });
  const webContext = input.webPages?.length
    ? `\n\n## 本次联网检索到的网页（只能引用这些，禁止编造 URL）\n${input.webPages
        .map(
          (p, i) =>
            `[web:${i + 1}] ${p.title}\nURL: ${p.url}\n摘要：${p.text.replace(/\s+/g, " ").slice(0, 800)}`,
        )
        .join("\n\n")}`
    : "";
  const { system, user } = assemble(deps.lib, "chat-notebook", {
    language: deps.language,
    vars: {
      scope_mode: input.scope.mode,
      question: input.question,
      current_path: input.currentPath,
      selected_text: input.selectedText ?? "",
      scope_pages: input.scope.pages.map((p) => `- ${p.title}`).join("\n"),
    },
    contractSections: ["A", "C"],
    withSources: true,
    context: baseContext + webContext,
  });
  const parser = new StreamParser();
  for await (const delta of chatStream(
    deps.fetchFn,
    deps.model,
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { temperature: 0.5, signal: input.signal },
  )) {
    for (const ev of parser.push(delta)) yield ev;
  }
  for (const ev of parser.flush()) yield ev;
  yield { type: "done", cites: parser.cites };
}

export async function generateComponent(
  deps: AiDeps,
  promptId: string,
  vars: Record<string, string>,
  contextText: string,
): Promise<unknown> {
  const { system, user } = assemble(deps.lib, promptId, {
    language: deps.language,
    vars,
    contractSections: ["B"],
    withSources: true,
    context: contextText,
  });
  const raw = await chatComplete(deps.fetchFn, deps.model, [
    { role: "system", content: system },
    { role: "user", content: user },
  ], { temperature: 0.4, maxTokens: 4000 });
  try {
    return normalizeComponentData(extractJson<unknown>(raw));
  } catch {
    // 组件是 JSON 协议，解析失败时让模型只做一次格式修复，尽量不把整次生成判死
    const fixed = await chatComplete(deps.fetchFn, deps.model, [
      {
        role: "system",
        content:
          "你是 JSON 修复器。把用户给你的内容整理成严格合法的 JSON：只输出 JSON，不要解释文字，不要代码围栏；" +
          "顶层必须是包含 items 数组的对象（原文若是数组，请包成 {\"items\": [...]}），保持原有字段、数量和文字内容不变；" +
          "字符串里的反斜杠必须正确转义（例如 LaTeX 的 \\( 要写成 \\\\(）。",
      },
      { role: "user", content: raw.slice(0, 12000) },
    ], { temperature: 0, maxTokens: 4000 });
    return normalizeComponentData(extractJson<unknown>(fixed));
  }
}

/** 组件里承载条目的常见字段名：模型偶尔不按 schema 写 items */
const ITEM_ARRAY_KEYS = ["items", "cards", "questions", "terms", "entries", "list", "rows"];

/**
 * 把组件 JSON 统一成 {"items": [...]} 的顶层结构。
 * 模型有时直接返回数组、换成 cards/questions 等字段，或再包一层 data/result，
 * 这些都视为同一份组件数据，避免一次格式偏差让整页生成失败。
 */
export function normalizeComponentData(data: unknown): unknown {
  if (Array.isArray(data)) return { items: data };
  if (!data || typeof data !== "object") return data;
  const obj = data as Record<string, unknown>;
  if (Array.isArray(obj.items)) return obj;
  // 少数模型会把 items 写成以 id 为键的对象而不是数组
  if (obj.items && typeof obj.items === "object") {
    const values = Object.values(obj.items as Record<string, unknown>);
    if (values.length) return { ...obj, items: values };
  }
  for (const key of ITEM_ARRAY_KEYS) {
    if (Array.isArray(obj[key])) return { ...obj, items: obj[key] };
  }
  for (const key of ["data", "result", "output", "payload"]) {
    const inner = obj[key];
    if (inner === undefined) continue;
    const fixed = normalizeComponentData(inner);
    if (fixed && typeof fixed === "object" && Array.isArray((fixed as Record<string, unknown>).items)) {
      const picked = fixed as Record<string, unknown>;
      return { ...picked, type: obj.type ?? picked.type, title: obj.title ?? picked.title };
    }
  }
  // 兜底：顶层唯一的数组字段就是条目
  const arrayKey = Object.keys(obj).find((key) => Array.isArray(obj[key]));
  if (arrayKey) return { ...obj, items: obj[arrayKey] };
  return data;
}

export function buildSources(nb: Notebook, nodeId: string, pages: WebPage[]): SourceRef[] {
  const out: SourceRef[] = [];
  let id = 1;
  const node = nb.nodes.find((n) => n.id === nodeId);
  for (const a of node?.attachments ?? []) {
    out.push({ id: id++, kind: "local", title: a.name, path: a.path });
  }
  for (const p of pages) {
    out.push({ id: id++, kind: "web", title: p.title, url: p.url });
  }
  return out;
}

/** 生成本页时程序实际读取的资料：本页/根/继承来的附件，加上本章已写好的页。 */
export function collectReadSources(nb: Notebook, nodeId: string): SourceRef[] {
  const byId = new Map(nb.nodes.map((n) => [n.id, n]));
  const chain: Node[] = [];
  let cur = byId.get(nodeId);
  while (cur) {
    chain.unshift(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  const out: SourceRef[] = [];
  const seen = new Set<string>();
  const add = (kind: SourceRef["kind"], title: string, path?: string) => {
    const key = `${kind}|${title}|${path ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ id: out.length + 1, kind, title, path });
  };
  for (const n of chain) {
    // 与 collectNodeContext 一致：根文件全读，本页附件全读，其余祖先只读“继承到下级”的
    const used = n.id === nodeId || n.kind === "root" ? n.attachments ?? [] : (n.attachments ?? []).filter((a) => a.inherit);
    for (const a of used) add("local", a.name, a.path);
  }
  const chapter = chain.filter((n) => n.kind === "chapter").pop();
  if (chapter) {
    for (const s of nb.nodes
      .filter((n) => n.parentId === chapter.id && n.status === "done" && n.id !== nodeId)
      .sort((a, b) => a.order - b.order)
      .slice(0, 6)) {
      add("page", s.title);
    }
  }
  return out;
}

export function emptyNotebookTitle(topic: string): string {
  return topic.trim().slice(0, 40) || `新笔记本 ${newId("t").slice(-4)}`;
}

// ---------------------------------------------------------------- 自定义页与结构

/** 侧边栏自由描述生成一页：先判类型，再按该类型填内容（§2.4 约定 10） */
export async function generateCustomPage(
  deps: AiDeps,
  input: {
    request: string;
    scope: string;
    attachments: string[];
    structureHint: string;
    context: string;
  },
): Promise<{
  type?: string;
  title?: string;
  suggested_parent?: string;
  content?: Record<string, unknown>;
  missing?: string[];
  one_line_note?: string;
}> {
  const { system, user } = assemble(deps.lib, "component-custom-page", {
    language: deps.language,
    vars: {
      request: input.request,
      scope: input.scope,
      attachments: input.attachments.join("、") || "无",
      structure_hint: input.structureHint,
    },
    contractSections: ["B"],
    withSources: true,
    context: input.context,
  });
  const raw = await chatComplete(
    deps.fetchFn,
    deps.model,
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { temperature: 0.5, maxTokens: 4000 },
  );
  return extractJson(raw);
}

/** AI 重构结构：只返回补丁，不整树覆盖（D-016） */
export interface StructurePatch {
  type?: string;
  ops?: Array<{
    op: "add" | "rename" | "move" | "remove";
    id: string;
    parentId?: string;
    afterId?: string;
    title?: string;
    goal?: string;
  }>;
  renamed_with_content?: string[];
  one_line_warning?: string;
  rejected?: string;
}

export async function restructureOutline(
  deps: AiDeps,
  input: { scope: "book" | "chapter"; structureJson: string; instruction: string; lockedIds: string[] },
): Promise<StructurePatch> {
  const { system, user } = assemble(deps.lib, "outline-restructure", {
    language: deps.language,
    vars: {
      scope: input.scope,
      structure_json: input.structureJson,
      instruction: input.instruction,
      locked_ids: input.lockedIds.join("、") || "无",
    },
    contractSections: [],
    withSources: false,
  });
  const raw = await chatComplete(
    deps.fetchFn,
    deps.model,
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { temperature: 0.4, maxTokens: 3000 },
  );
  return extractJson<StructurePatch>(raw);
}
