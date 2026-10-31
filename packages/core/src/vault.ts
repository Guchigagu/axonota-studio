import type { VaultFs } from "./fs";
import type {
  Attachment,
  GenStatus,
  Node,
  Notebook,
  OutlineDraft,
  Settings,
  SourceRef,
} from "./types";
import { parseFrontMatter, stringifyFrontMatter } from "./frontmatter";
import { newId, nowIso } from "./ids";
import { P } from "./paths";

export interface NotebookSummary {
  id: string;
  title: string;
  topic: string;
  updatedAt: string;
  nodeCount: number;
  doneCount: number;
  /** 列表头像渐变配色 id；空则用默认 */
  color?: string;
}

export interface ChatEntry {
  id: string;
  role: "user" | "assistant";
  content: string;
  cites?: SourceRef[];
  createdAt: string;
  /** 会话 id：同一次连续对话属于同一会话，用于历史会话分组 */
  sessionId?: string;
  /** 这条 AI 回答对应的问题，重载历史时用来还原用户消息 */
  question?: string;
  /** 这条消息属于哪个节点；每个节点的对话互相独立 */
  nodeId?: string;
}

const DEFAULT_SETTINGS: Settings = {
  models: [],
  webSearch: true,
  theme: "light",
};

export class Vault {
  constructor(private fs: VaultFs) {}

  /** 索引文件是「读-改-写」：并行生成多篇时多个节点会同时改同一份 notebook，必须串行 */
  private indexLock: Promise<void> = Promise.resolve();

  private async withIndex<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.indexLock;
    let release = () => {};
    this.indexLock = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  async init(): Promise<void> {
    await this.fs.mkdir(P.notebooks);
    if (!(await this.fs.exists(P.settings))) {
      await this.saveSettings(DEFAULT_SETTINGS);
    }
  }

  // ---------------------------------------------------------------- settings

  async getSettings(): Promise<Settings> {
    if (!(await this.fs.exists(P.settings))) return { ...DEFAULT_SETTINGS };
    try {
      const raw = await this.fs.readText(P.settings);
      return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } as Settings;
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  async saveSettings(settings: Settings): Promise<void> {
    await this.fs.writeText(P.settings, JSON.stringify(settings, null, 2));
  }

  async addModel(model: Settings["models"][number], makeDefault = false): Promise<Settings> {
    const s = await this.getSettings();
    s.models = [...s.models.filter((m) => m.id !== model.id), model];
    if (makeDefault || !s.defaultModelId) s.defaultModelId = model.id;
    await this.saveSettings(s);
    return s;
  }

  async removeModel(modelId: string): Promise<Settings> {
    const s = await this.getSettings();
    s.models = s.models.filter((m) => m.id !== modelId);
    if (s.defaultModelId === modelId) s.defaultModelId = s.models[0]?.id;
    await this.saveSettings(s);
    return s;
  }

  async setDefaultModel(modelId: string | undefined): Promise<Settings> {
    const s = await this.getSettings();
    s.defaultModelId = modelId;
    await this.saveSettings(s);
    return s;
  }

  async setWebSearch(on: boolean): Promise<Settings> {
    const s = await this.getSettings();
    s.webSearch = on;
    await this.saveSettings(s);
    return s;
  }

  async setLanguage(language: Settings["language"]): Promise<Settings> {
    const s = await this.getSettings();
    s.language = language;
    await this.saveSettings(s);
    return s;
  }

  // --------------------------------------------------------------- notebooks

  async listNotebooks(): Promise<NotebookSummary[]> {
    const entries = await this.fs.list(P.notebooks).catch(() => []);
    const out: NotebookSummary[] = [];
    for (const e of entries) {
      if (!e.isDir) continue;
      try {
        const nb = await this.loadNotebook(e.name);
        if (!nb) continue;
        out.push({
          id: nb.id,
          title: nb.title,
          topic: nb.topic,
          updatedAt: nb.updatedAt,
          nodeCount: nb.nodes.filter((n) => n.kind !== "root").length,
          doneCount: nb.nodes.filter((n) => n.status === "done").length,
          color: nb.color,
        });
      } catch {
        // 单个笔记本损坏不影响列表
      }
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async loadNotebook(id: string): Promise<Notebook | null> {
    if (!(await this.fs.exists(P.notebookFile(id)))) return null;
    const raw = await this.fs.readText(P.notebookFile(id));
    const { data, body } = parseFrontMatter(raw);
    const nodes = (data.nodes as Node[] | undefined) ?? [];
    const nb: Notebook = {
      id,
      title: String(data.title ?? "未命名笔记本"),
      topic: String(data.topic ?? ""),
      assumption: data.assumption ? String(data.assumption) : undefined,
      scope: data.scope ? String(data.scope) : undefined,
      style: String(data.style ?? "feynman"),
      color: data.color ? String(data.color) : undefined,
      webSearch: data.webSearch !== false,
      defaultModelId: data.defaultModelId ? String(data.defaultModelId) : undefined,
      nodes: nodes.map((n) => ({
        ...n,
        attachments: n.attachments ?? [],
        sources: n.sources ?? [],
        highlights: n.highlights ?? [],
      })),
      createdAt: String(data.createdAt ?? nowIso()),
      updatedAt: String(data.updatedAt ?? nowIso()),
    };
    // 正文额外存一份摘要，避免 notebook.md 变得不可读
    if (body.trim()) nb.assumption = nb.assumption ?? body.trim();
    return nb;
  }

  async saveNotebook(nb: Notebook): Promise<void> {
    nb.updatedAt = nowIso();
    await this.fs.mkdir(P.notebookDir(nb.id));
    const data: Record<string, unknown> = {
      id: nb.id,
      title: nb.title,
      topic: nb.topic,
      assumption: nb.assumption,
      scope: nb.scope,
      style: nb.style,
      color: nb.color,
      webSearch: nb.webSearch,
      defaultModelId: nb.defaultModelId,
      createdAt: nb.createdAt,
      updatedAt: nb.updatedAt,
      nodes: nb.nodes,
    };
    const body = nb.scope ? `> ${nb.scope}\n` : "";
    await this.fs.writeText(P.notebookFile(nb.id), stringifyFrontMatter(data, body));
    await this.fs.mkdir(P.nodeDir(nb.id));
    await this.fs.mkdir(P.filesDir(nb.id));
  }

  async createNotebookFromOutline(input: {
    topic: string;
    draft: OutlineDraft;
    style: string;
    webSearch: boolean;
    title?: string;
  }): Promise<Notebook> {
    const nbId = newId("nb");
    const ts = nowIso();
    const root: Node = {
      id: newId("n"),
      parentId: null,
      kind: "root",
      title: input.title ?? input.topic,
      order: 0,
      status: "todo",
      createdBy: "ai",
      summary: input.draft.scope_one_line,
      attachments: [],
      sources: [],
      updatedAt: ts,
    };
    const nodes: Node[] = [root];
    let chapterOrder = 0;
    for (const ch of input.draft.chapters) {
      const chapter: Node = {
        id: newId("n"),
        parentId: root.id,
        kind: "chapter",
        title: ch.title,
        order: chapterOrder++,
        status: "todo",
        createdBy: "ai",
        goal: ch.goal,
        attachments: [],
        sources: [],
        updatedAt: ts,
      };
      nodes.push(chapter);
      let sectionOrder = 0;
      for (const sec of ch.sections) {
        if (!sec.title?.trim()) continue;
        nodes.push({
          id: newId("n"),
          parentId: chapter.id,
          kind: "section",
          title: sec.title,
          order: sectionOrder++,
          status: "todo",
          createdBy: "ai",
          goal: sec.goal,
          attachments: [],
          sources: [],
          updatedAt: ts,
        });
      }
    }
    const nb: Notebook = {
      id: nbId,
      title: input.title ?? input.topic,
      topic: input.topic,
      assumption: input.draft.assumption,
      scope: input.draft.scope_one_line,
      style: input.style,
      webSearch: input.webSearch,
      nodes,
      createdAt: ts,
      updatedAt: ts,
    };
    await this.saveNotebook(nb);
    return nb;
  }

  async deleteNotebook(nbId: string): Promise<void> {
    await this.fs.remove(P.notebookDir(nbId));
  }

  // ------------------------------------------------------------------- nodes

  async getNodeBody(nbId: string, nodeId: string): Promise<string> {
    const path = P.nodeFile(nbId, nodeId);
    if (!(await this.fs.exists(path))) return "";
    const raw = await this.fs.readText(path);
    return parseFrontMatter(raw).body;
  }

  /** 读取任意 vault 相对路径的文本（附件摘要用） */
  async getRawText(path: string): Promise<string> {
    if (!(await this.fs.exists(path))) return "";
    return this.fs.readText(path);
  }

  /** 读取任意 vault 相对路径的二进制（图片附件、归档导入用） */
  async getRawBinary(path: string): Promise<Uint8Array> {
    return this.fs.readBinary(path);
  }

  /** 写入任意 vault 相对路径（导入归档时重建附件） */
  async writeRawBinary(path: string, data: Uint8Array): Promise<void> {
    await this.fs.writeBinary(path, data);
  }

  async writeRawText(path: string, data: string): Promise<void> {
    await this.fs.writeText(path, data);
  }

  async putNodeBody(
    nbId: string,
    nodeId: string,
    markdown: string,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    await this.fs.mkdir(P.nodeDir(nbId));
    await this.fs.writeText(
      P.nodeFile(nbId, nodeId),
      stringifyFrontMatter({ id: nodeId, updatedAt: nowIso(), ...extra }, markdown),
    );
  }

  async updateNode(
    nbId: string,
    nodeId: string,
    patch: Partial<
      Pick<Node, "title" | "status" | "goal" | "summary" | "sources" | "attachments" | "pageKind" | "highlights">
    >,
  ): Promise<Notebook> {
    return this.withIndex(async () => {
      const nb = await this.loadNotebook(nbId);
      if (!nb) throw new Error(`笔记本不存在：${nbId}`);
      const node = nb.nodes.find((n) => n.id === nodeId);
      if (!node) throw new Error(`节点不存在：${nodeId}`);
      Object.assign(node, patch, { updatedAt: nowIso() });
      if (patch.status === "done") node.generatedAt = nowIso();
      await this.saveNotebook(nb);
      return nb;
    });
  }

  async setNodeStatus(nbId: string, nodeId: string, status: GenStatus): Promise<void> {
    await this.updateNode(nbId, nodeId, { status });
  }

  async addNode(
    nbId: string,
    input: {
      parentId: string;
      title: string;
      kind: Node["kind"];
      pageKind?: Node["pageKind"];
      createdBy?: "ai" | "user";
    },
  ): Promise<Node> {
    return this.withIndex(async () => {
      const nb = await this.loadNotebook(nbId);
      if (!nb) throw new Error(`笔记本不存在：${nbId}`);
      const siblings = nb.nodes.filter((n) => n.parentId === input.parentId);
      const node: Node = {
        id: newId("n"),
        parentId: input.parentId,
        kind: input.kind,
        pageKind: input.pageKind,
        title: input.title,
        order: siblings.length,
        status: "todo",
        createdBy: input.createdBy ?? "user",
        attachments: [],
        sources: [],
        updatedAt: nowIso(),
      };
      nb.nodes.push(node);
      await this.saveNotebook(nb);
      return node;
    });
  }

  async renameNode(nbId: string, nodeId: string, title: string): Promise<void> {
    await this.updateNode(nbId, nodeId, { title });
  }

  /** 同级重排：只改 order，不改 parentId（D-016） */
  async reorderNode(nbId: string, nodeId: string, toIndex: number): Promise<void> {
    const nb = await this.loadNotebook(nbId);
    if (!nb) return;
    const node = nb.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    const siblings = nb.nodes
      .filter((n) => n.parentId === node.parentId)
      .sort((a, b) => a.order - b.order);
    const from = siblings.findIndex((n) => n.id === nodeId);
    if (from === -1) return;
    const [moved] = siblings.splice(from, 1);
    siblings.splice(Math.max(0, Math.min(toIndex, siblings.length)), 0, moved);
    siblings.forEach((n, i) => {
      n.order = i;
      n.updatedAt = nowIso();
    });
    await this.saveNotebook(nb);
  }

  /** 跨层移动：显式操作，不靠拖动隐式完成（D-016） */
  async moveNode(nbId: string, nodeId: string, newParentId: string): Promise<void> {
    const nb = await this.loadNotebook(nbId);
    if (!nb) return;
    const node = nb.nodes.find((n) => n.id === nodeId);
    if (!node || node.id === newParentId) return;
    const descendants = new Set<string>();
    const walk = (id: string) => {
      descendants.add(id);
      nb.nodes.filter((n) => n.parentId === id).forEach((c) => walk(c.id));
    };
    walk(nodeId);
    if (descendants.has(newParentId)) return; // 不能移到自己的子孙下
    node.parentId = newParentId;
    node.order = nb.nodes.filter((n) => n.parentId === newParentId).length;
    await this.saveNotebook(nb);
  }

  /** 删除节点及其整棵子树，正文文件一并移入系统回收站 */
  async removeNode(nbId: string, nodeId: string): Promise<void> {
    const nb = await this.loadNotebook(nbId);
    if (!nb) return;
    const doomed = new Set<string>();
    const walk = (id: string) => {
      doomed.add(id);
      nb.nodes.filter((n) => n.parentId === id).forEach((c) => walk(c.id));
    };
    walk(nodeId);
    nb.nodes = nb.nodes.filter((n) => !doomed.has(n.id));
    for (const id of doomed) {
      const p = P.nodeFile(nbId, id);
      if (await this.fs.exists(p)) await this.fs.remove(p);
    }
    await this.saveNotebook(nb);
  }

  // ------------------------------------------------------------- attachments

  async saveAttachment(
    nbId: string,
    file: { name: string; bytes: Uint8Array },
    inherit: boolean,
  ): Promise<Attachment> {
    const id = newId("f");
    const safeName = file.name.replace(/[\\/:*?"<>|]/g, "_");
    const path = `${P.filesDir(nbId)}/${id}-${safeName}`;
    await this.fs.mkdir(P.filesDir(nbId));
    await this.fs.writeBinary(path, file.bytes);
    return {
      id,
      name: file.name,
      path,
      size: file.bytes.length,
      inherit,
      addedAt: nowIso(),
    };
  }

  async attachToNode(nbId: string, nodeId: string, attachment: Attachment): Promise<void> {
    const nb = await this.loadNotebook(nbId);
    if (!nb) return;
    const node = nb.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    node.attachments = [...(node.attachments ?? []), attachment];
    node.updatedAt = nowIso();
    await this.saveNotebook(nb);
  }

  async removeAttachment(nbId: string, nodeId: string, attachmentId: string): Promise<void> {
    const nb = await this.loadNotebook(nbId);
    if (!nb) return;
    const node = nb.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    const target = node.attachments.find((a) => a.id === attachmentId);
    node.attachments = node.attachments.filter((a) => a.id !== attachmentId);
    if (target && (await this.fs.exists(target.path))) await this.fs.remove(target.path);
    await this.saveNotebook(nb);
  }

  /** 逐层继承：自身 + 所有祖先（D-011），继承开关为 false 的附件只留在本层 */
  collectAttachments(nb: Notebook, nodeId: string): Attachment[] {
    const byId = new Map(nb.nodes.map((n) => [n.id, n]));
    const chain: Node[] = [];
    let cur: Node | undefined = byId.get(nodeId);
    while (cur) {
      chain.unshift(cur);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    const out: Attachment[] = [];
    chain.forEach((node, depth) => {
      const isSelf = depth === chain.length - 1;
      for (const a of node.attachments ?? []) {
        if (isSelf || a.inherit) out.push(a);
      }
    });
    return out;
  }

  // -------------------------------------------------------------------- chat

  async loadChat(nbId: string): Promise<ChatEntry[]> {
    const path = P.chatFile(nbId);
    if (!(await this.fs.exists(path))) return [];
    const raw = await this.fs.readText(path);
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as ChatEntry;
        } catch {
          return null;
        }
      })
      .filter((x): x is ChatEntry => !!x);
  }

  async appendChat(nbId: string, entry: ChatEntry): Promise<void> {
    const path = P.chatFile(nbId);
    const prev = await this.fs.exists(path) ? await this.fs.readText(path) : "";
    await this.fs.writeText(path, prev + JSON.stringify(entry) + "\n");
  }
}
