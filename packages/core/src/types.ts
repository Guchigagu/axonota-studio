/** 核心数据模型。所有字段都会被写入 Markdown front matter，因此保持扁平、可序列化。 */

export type NodeKind = "root" | "chapter" | "section" | "page";

export type PageKind =
  | "note"
  | "flashcards"
  | "glossary"
  | "custom";

export type GenStatus = "todo" | "running" | "done" | "failed";

export interface SourceRef {
  /** 引用编号，正文里的 [[cite:n]] 对应此值 */
  id: number;
  /** local = 用户上传资料；web = 网络检索；page = 笔记本内的其他页 */
  kind: "local" | "web" | "page";
  title: string;
  /** vault 相对路径（local / page） */
  path?: string;
  /** 原始链接（web） */
  url?: string;
}

export interface Attachment {
  id: string;
  name: string;
  /** vault 相对路径 */
  path: string;
  size?: number;
  /** true = 继承到下级；false = 仅本层（D-011） */
  inherit: boolean;
  addedAt: string;
}

/** 高亮：用户私有资产（默认不进 AI 上下文，D-023） */
export interface Highlight {
  id: string;
  /** 被高亮的原文 */
  text: string;
  createdAt: string;
}

export interface Node {
  id: string;
  parentId: string | null;
  kind: NodeKind;
  /** 仅 kind === "page" 时有值 */
  pageKind?: PageKind;
  title: string;
  /** 同一父节点下的排序，全产品只有一份顺序（D-016） */
  order: number;
  status: GenStatus;
  createdBy: "ai" | "user";
  /** 学完能做到什么（章 / 节） */
  goal?: string;
  /** 概览页的路线建议等 */
  summary?: string;
  attachments: Attachment[];
  sources: SourceRef[];
  /** 高亮，随节点 front matter 持久化 */
  highlights?: Highlight[];
  updatedAt: string;
  generatedAt?: string;
}

export interface Notebook {
  id: string;
  title: string;
  topic: string;
  /** 主题收敛依据 */
  assumption?: string;
  /** 一句话：这本笔记让你能做到什么 */
  scope?: string;
  /** 当前讲解风格（内置 id 或自定义描述） */
  style: string;
  /** 列表头像的渐变配色 id（见工作台的配色表），空则用默认 */
  color?: string;
  webSearch: boolean;
  defaultModelId?: string;
  nodes: Node[];
  createdAt: string;
  updatedAt: string;
}

export interface ModelConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  modelId: string;
  createdAt: string;
}

export interface Settings {
  models: ModelConfig[];
  defaultModelId?: string;
  webSearch: boolean;
  theme: "light" | "dark";
  /** 界面与生成内容语言；首次启动未选择时为空，由首启遮罩要求选一次 */
  language?: "zh" | "en";
}

export interface StylePreset {
  id: string;
  name: string;
  /** 拼进提示词的风格描述 */
  description: string;
}

export interface OutlineSection {
  id: string;
  title: string;
  goal?: string;
}

export interface OutlineChapter {
  id: string;
  title: string;
  goal?: string;
  sections: OutlineSection[];
}

export interface OutlineDraft {
  type: "outline";
  assumption?: string;
  scope_one_line?: string;
  chapters: OutlineChapter[];
  coverage_gaps?: string[];
  sources?: Array<{ title: string; url?: string }>;
}

export interface Citation {
  id: number;
  kind: "local" | "web" | "page";
  title: string;
  path?: string;
  url?: string;
}

export interface Tab {
  id: string;
  nodeId: string | null;
  title: string;
  kind: "mindmap" | "note" | "page";
}
