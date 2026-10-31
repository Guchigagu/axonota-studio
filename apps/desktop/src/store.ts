import { create } from "zustand";
import {
  buildChatScope,
  collectNodeContext,
  collectReadSources,
  contextBlock,
  formatOutlineText,
  generateComponent,
  generateCustomPage as generateCustomPageCore,
  generateOutline,
  parseOutlineText,
  pickModel,
  restructureOutline,
  STYLE_PRESETS,
  streamChat,
  streamNodeContent,
  suggestTitles,
  newId,
  nowIso,
  P,
  type ChatScope,
  type ChatEntry,
  type NotebookSummary,
  type OutlineDraft,
  type Settings,
  type Tab,
  type Node,
  type Notebook,
  type Highlight,
  type Vault,
} from "@nb/core";
import { fetchFn, getVault, lib, revealPath, saveExportFile } from "./lib/env";
import { buildPrintHtml, printHtml } from "./lib/export";
import { buildZip, makeTextEntry, readZip, textEntry } from "./lib/zip";
import { searchWeb } from "./lib/web";
import { pick, type Lang } from "./lib/lang";

export type Screen = { name: "home" } | { name: "notebook"; nbId: string } | { name: "settings" };

/** 批量生成时的并行篇数：同时开 4 条流式请求，节点之间互不等待 */
const GEN_CONCURRENCY = 4;

/** 并发池：同时跑 limit 个任务，单个任务失败不影响其他任务 */
async function runPool<T>(items: T[], limit: number, task: (item: T) => Promise<void>) {
  const queue = items.slice();
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift() as T;
      await task(item);
    }
  });
  await Promise.all(workers);
}

export interface ChatMessageView {
  id: string;
  role: "user" | "assistant";
  content: string;
  cites?: number[];
  error?: boolean;
  /** 这条回答实际读到的页面标题，用于「参考了 N 页」 */
  pages?: string[];
  /** 与 pages 对应的节点 id，点标签可跳到该页 */
  pageIds?: Array<string | null>;
  /** 这条回答的用时（毫秒） */
  ms?: number;
  /** 触发这条回答的问题，供「重新生成」原样再问 */
  question?: string;
  /** 这条消息属于哪个节点；每个节点的对话互相独立 */
  nodeId?: string;
}

/** 历史会话摘要：从 chat.jsonl 按 sessionId 聚合 */
export interface ChatSessionSummary {
  id: string;
  title: string;
  at: string;
  rounds: number;
  /** 会话所属节点，历史列表按当前节点过滤 */
  nodeId?: string;
}

/** 对话里随消息上传的文本资料：只用于本次提问，不写入 vault */
export interface ChatUpload {
  name: string;
  text: string;
}

interface AppStore {
  ready: boolean;
  error: string | null;
  settings: Settings;
  notebooks: NotebookSummary[];
  screen: Screen;
  nb: Notebook | null;
  tabs: Tab[];
  activeTabId: string;
  bodies: Record<string, string>;
  generating: Record<string, boolean>;
  chatOpen: boolean;
  chat: ChatMessageView[];
  chatScope: "chapter" | "book" | "auto";
  /** 对话里临时切换的模型；为空时跟随笔记本默认模型 */
  chatModelId: string | null;
  chatBusy: boolean;
  chatSessionId: string;
  /** 每个节点自己的会话 id：切换节点时不会串对话 */
  nodeSessionIds: Record<string, string>;
  chatSessions: ChatSessionSummary[];
  mindmapCurrentId: string | null;
  /** 阅读区选中的文字，划词提问时带进对话上下文 */
  selection: string | null;
  /** 新建大纲流程：放在 store 里，切到别的页面再回来不会丢 */
  outlineInput: NewNotebookInput | null;
  outlineDraft: OutlineDraft | null;
  outlineText: string;
  outlineBusy: boolean;
  outlineAdjusting: boolean;
  outlineConfirming: boolean;
  outlineError: string | null;
  /** 底部轻提示（导出成功、已生成等） */
  notice: string | null;
  /** 最近一次导出的落盘路径，用于「在文件夹中显示」 */
  exportPath: string | null;
  /** 附件预览：阅读页点附件名时打开（文本直接显示，图片给 blob URL） */
  preview: AttachmentPreview | null;
  previewAttachment: (nodeId: string, attachmentId: string) => Promise<void>;
  closePreview: () => void;
  setNotice: (text: string | null) => void;
  revealExport: () => void;

  boot: () => Promise<void>;
  refreshNotebooks: () => Promise<void>;
  openHome: () => void;
  openSettings: () => void;
  openNotebook: (nbId: string) => Promise<void>;
  /** 切换当前笔记本的讲解风格：写入 notebook.md，只影响之后生成/重新生成的页面 */
  setNotebookStyle: (style: string) => Promise<void>;
  /** 改笔记本列表头像的渐变配色，写回 notebook.md；传空串恢复默认 */
  setNotebookColor: (nbId: string, color: string) => Promise<void>;
  previewOutline: (input: NewNotebookInput) => Promise<OutlineDraft>;
  /** 生成大纲并把结果留在 store；页面切走也继续跑，回来能看到进度或结果 */
  startOutline: (input: NewNotebookInput) => Promise<void>;
  setOutlineText: (text: string) => void;
  /** 按调整要求重出大纲，替换当前文本 */
  refineOutline: (requirement: string) => Promise<void>;
  /** 确认大纲：建本并跳到思维导图；withContent=true 时顺带后台生成整本 */
  commitOutline: (withContent?: boolean) => Promise<void>;
  closeOutline: () => void;
  createNotebookFromDraft: (input: NewNotebookInput, draft: OutlineDraft) => Promise<void>;
  seedDemoNotebook: () => Promise<void>;
  deleteNotebook: (nbId: string) => Promise<void>;
  saveModel: (m: Settings["models"][number], makeDefault: boolean) => Promise<void>;
  removeModel: (id: string) => Promise<void>;
  setDefaultModel: (id: string) => Promise<void>;
  toggleWebSearch: () => Promise<void>;
  selectTab: (id: string) => void;
  closeTab: (id: string) => void;
  openNode: (nodeId: string) => Promise<void>;
  renameNode: (nodeId: string, title: string) => Promise<void>;
  addChildNode: (parentId: string, title: string) => Promise<void>;
  deleteNode: (nodeId: string) => Promise<void>;
  ensureBody: (nodeId: string) => Promise<void>;
  saveBody: (nodeId: string, markdown: string) => Promise<void>;
  generateNode: (nodeId: string) => Promise<void>;
  generateRange: (nodeId: string) => Promise<void>;
  generatePage: (nodeId: string, kind: ComponentKind) => Promise<void>;
  addAttachments: (nodeId: string, files: File[]) => Promise<void>;
  toggleAttachmentInherit: (nodeId: string, attachmentId: string) => Promise<void>;
  removeAttachmentById: (nodeId: string, attachmentId: string) => Promise<void>;
  /** 导出 Markdown；scope=chapter 时只导出某一章的子树 */
  exportNotebook: (scope?: "book" | "chapter", chapterId?: string) => Promise<void>;
  /** 导出可再导入的 zip 归档（整本／单章） */
  exportArchive: (scope?: "book" | "chapter", chapterId?: string) => Promise<void>;
  /** 导出阅读稿 PDF（调系统打印，可另存为 PDF） */
  exportPdf: (scope?: "book" | "chapter", chapterId?: string) => Promise<void>;
  /** 导入 zip 归档，作为一本新笔记本 */
  importArchive: (file: File) => Promise<void>;
  /** 高亮（用户私有资产，持久化在节点 front matter） */
  addHighlight: (nodeId: string, text: string) => Promise<void>;
  removeHighlight: (nodeId: string, id: string) => Promise<void>;
  /** 同级拖动重排；跨层移动用 moveNode */
  reorderNode: (nodeId: string, toIndex: number) => Promise<void>;
  moveNode: (nodeId: string, newParentId: string) => Promise<void>;
  /** 用 AI 重构结构；scopeNodeId 为空表示整本 */
  restructureNode: (scopeNodeId: string | null, instruction: string) => Promise<string>;
  /** 自由描述生成自定义页（可带附件上下文） */
  generateCustomPage: (request: string) => Promise<void>;
  setSelection: (text: string | null) => void;
  setChatOpen: (open: boolean) => void;
  setChatScope: (scope: "chapter" | "book" | "auto") => Promise<void>;
  setChatModel: (id: string | null) => void;
  /** 清空当前对话（新对话），不删除 chat.jsonl 里已归档的内容 */
  clearChat: () => void;
  /** 读取本笔记本的历史会话摘要 */
  refreshChatSessions: () => Promise<void>;
  /** 载入某次历史会话到对话面板 */
  openChatSession: (sessionId: string) => Promise<void>;
  /** 把一条 AI 回答存成节/章下的一页笔记 */
  saveChatAsNote: (content: string) => Promise<void>;
  sendChat: (question: string, uploads?: ChatUpload[]) => Promise<void>;
  setTheme: (theme: "light" | "dark") => Promise<void>;
  /** 切换界面与生成内容语言；首次启动必须选一次 */
  setLanguage: (language: Lang) => Promise<void>;
}

export type ComponentKind = "flashcards" | "glossary";

/** 建本输入：只出大纲阶段与确认成书阶段共用 */
export interface NewNotebookInput {
  topic: string;
  requirement?: string;
  style: string;
  rootText?: { name: string; text: string };
}

export interface AttachmentPreview {
  name: string;
  kind: "text" | "image";
  text?: string;
  url?: string;
}

const COMPONENT_LABEL: Record<ComponentKind, { zh: string; en: string }> = {
  flashcards: { zh: "闪卡", en: "Flashcards" },
  glossary: { zh: "速查表", en: "Glossary" },
};

const MINDMAP_TAB: Tab = { id: "mindmap", nodeId: null, title: "思维导图", kind: "mindmap" };

const emptySettings: Settings = { models: [], webSearch: true, theme: "light" };

function deps(settings: Settings, modelId?: string) {
  return { fetchFn, lib, model: pickModel(settings, modelId), language: settings.language ?? "zh" };
}

export const useApp = create<AppStore>((set, get) => ({
  ready: false,
  error: null,
  settings: emptySettings,
  notebooks: [],
  screen: { name: "home" },
  nb: null,
  tabs: [MINDMAP_TAB],
  activeTabId: "mindmap",
  bodies: {},
  generating: {},
  chatOpen: false,
  chat: [],
  chatScope: "chapter",
  chatModelId: null,
  chatBusy: false,
  chatSessionId: newSessionId(),
  nodeSessionIds: {},
  chatSessions: [],
  mindmapCurrentId: null,
  selection: null,
  outlineInput: null,
  outlineDraft: null,
  outlineText: "",
  outlineBusy: false,
  outlineAdjusting: false,
  outlineConfirming: false,
  outlineError: null,
  notice: null,
  exportPath: null,
  preview: null,

  setNotice: (text) => set({ notice: text }),
  revealExport: () => {
    const path = get().exportPath;
    if (path) revealPath(path);
  },
  previewAttachment: async (nodeId, attachmentId) => {
    const nb = get().nb;
    if (!nb) return;
    const a = nb.nodes.find((n) => n.id === nodeId)?.attachments?.find((x) => x.id === attachmentId);
    if (!a) return;
    const vault = getVault();
    try {
      const mime = mimeOf(a.name);
      if (mime.startsWith("image/")) {
        const bytes = await vault.getRawBinary(a.path);
        set({
          preview: {
            name: a.name,
            kind: "image",
            url: URL.createObjectURL(new Blob([bytesToArrayBuffer(bytes)], { type: mime })),
          },
        });
      } else {
        set({ preview: { name: a.name, kind: "text", text: await vault.getRawText(a.path) } });
      }
    } catch (err) {
      set({ error: `附件预览失败：${err instanceof Error ? err.message : String(err)}` });
    }
  },
  closePreview: () => {
    const p = get().preview;
    if (p?.url) URL.revokeObjectURL(p.url);
    set({ preview: null });
  },

  boot: async () => {
    try {
      const vault = getVault();
      await vault.init();
      const settings = await vault.getSettings();
      set({ ready: true, settings });
      await get().refreshNotebooks();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), ready: true });
    }
  },

  refreshNotebooks: async () => {
    const list = await getVault().listNotebooks();
    set({ notebooks: list });
  },

  openHome: () => set({ screen: { name: "home" }, nb: null }),

  openSettings: () => set({ screen: { name: "settings" } }),

  openNotebook: async (nbId) => {
    const nb = await getVault().loadNotebook(nbId);
    if (!nb) return;
    set({ screen: { name: "notebook", nbId }, nb, tabs: [MINDMAP_TAB], activeTabId: "mindmap", bodies: {}, chat: [], chatSessionId: newSessionId(), nodeSessionIds: {}, selection: null, notice: null, exportPath: null });
  },

  setNotebookStyle: async (style) => {
    const nb = get().nb;
    if (!nb || nb.style === style) return;
    const next = { ...nb, style };
    await getVault().saveNotebook(next);
    set({ nb: next });
  },

  setNotebookColor: async (nbId, color) => {
    const vault = getVault();
    const nb = await vault.loadNotebook(nbId);
    if (!nb) return;
    nb.color = color || undefined;
    await vault.saveNotebook(nb);
    const cur = get().nb;
    if (cur?.id === nbId) set({ nb: { ...cur, color: nb.color } });
    set({ notebooks: await vault.listNotebooks() });
  },

  previewOutline: async (input) => {
    const settings = get().settings;
    const model = pickModel(settings);
    set({ error: null });
    try {
      return await generateOutline(deps(settings, model.id), {
        topic: input.topic,
        requirement: input.requirement,
        style: input.style,
        webSearch: settings.webSearch,
        rootFiles: input.rootText ? [input.rootText] : undefined,
      });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  },

  startOutline: async (input) => {
    if (get().outlineBusy) return;
    set({ outlineBusy: true, outlineError: null, outlineInput: input, outlineDraft: null, outlineText: "" });
    try {
      const draft = await get().previewOutline(input);
      set({ outlineDraft: draft, outlineText: formatOutlineText(draft) });
    } catch (err) {
      set({ outlineError: err instanceof Error ? err.message : String(err) });
    } finally {
      set({ outlineBusy: false });
    }
  },

  setOutlineText: (text) => set({ outlineText: text }),

  refineOutline: async (requirement) => {
    const { outlineInput, outlineDraft, outlineAdjusting } = get();
    if (!outlineInput || !outlineDraft || outlineAdjusting) return;
    set({ outlineAdjusting: true, outlineError: null });
    try {
      const merged = [outlineInput.requirement, `调整要求：${requirement}`].filter(Boolean).join("\n");
      const draft = await get().previewOutline({ ...outlineInput, requirement: merged });
      set({ outlineDraft: draft, outlineText: formatOutlineText(draft) });
    } catch (err) {
      set({ outlineError: err instanceof Error ? err.message : String(err) });
    } finally {
      set({ outlineAdjusting: false });
    }
  },

  commitOutline: async (withContent = false) => {
    const { outlineInput, outlineDraft, outlineText, outlineConfirming } = get();
    if (!outlineInput || !outlineDraft || outlineConfirming) return;
    const chapters = parseOutlineText(outlineText).chapters;
    if (!chapters.length) {
      set({
        outlineError: pick(
          get().settings.language,
          "至少要保留一章：每行一章，小节缩进两格。",
          "Keep at least one chapter: one chapter per line, indent sections by two spaces.",
        ),
      });
      return;
    }
    set({ outlineConfirming: true, outlineError: null });
    try {
      await get().createNotebookFromDraft(outlineInput, { ...outlineDraft, chapters });
      set({ outlineInput: null, outlineDraft: null, outlineText: "", outlineError: null });
      // 二选一里的「结构 + 整本内容」：建本后立即在后台开工，不把用户按在页面上等（§2.3 约定 6）
      if (withContent) {
        const nb = get().nb;
        const root = nb?.nodes.find((n) => n.kind === "root");
        if (nb && root) {
          set({ notice: pick(get().settings.language, "已开始后台生成整本，可随时离开这一页。", "Generating the whole notebook in the background — you can leave this page anytime.") });
          void get().generateRange(root.id);
        }
      }
    } catch (err) {
      set({ outlineError: err instanceof Error ? err.message : String(err) });
    } finally {
      set({ outlineConfirming: false });
    }
  },

  closeOutline: () => set({ outlineInput: null, outlineDraft: null, outlineText: "", outlineError: null }),

  createNotebookFromDraft: async (input, draft) => {
    const vault = getVault();
    const settings = get().settings;
    const model = pickModel(settings);
    set({ error: null });
    try {
      const titles = await suggestTitles(deps(settings, model.id), draft).catch(() => []);
      const nb = await vault.createNotebookFromOutline({
        topic: input.topic,
        draft,
        style: input.style,
        webSearch: settings.webSearch,
        title: titles[0] ?? input.topic,
      });
      if (input.rootText) {
        const root = nb.nodes.find((n) => n.kind === "root")!;
        const att = await vault.saveAttachment(
          nb.id,
          { name: input.rootText.name, bytes: new TextEncoder().encode(input.rootText.text) },
          true,
        );
        await vault.attachToNode(nb.id, root.id, att);
      }
      const fresh = await vault.loadNotebook(nb.id);
      set({ screen: { name: "notebook", nbId: nb.id }, nb: fresh, tabs: [MINDMAP_TAB], activeTabId: "mindmap", bodies: {} });
      await get().refreshNotebooks();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  },

  deleteNotebook: async (nbId) => {
    await getVault().deleteNotebook(nbId);
    await get().refreshNotebooks();
    if (get().screen.name === "notebook") get().openHome();
    set({
      notice: pick(
        get().settings.language,
        "笔记本已删除。需要找回时，打开系统回收站恢复对应文件夹。",
        "Notebook deleted. To restore it, recover the matching folder from the system Recycle Bin.",
      ),
    });
  },

  /** 离线示例：不调用模型，用来在没有 Key 时也能看到完整结构 */
  seedDemoNotebook: async () => {
    const vault = getVault();
    // 旧版示例没有组件页，重建时先清掉同名示例，避免叠加
    for (const old of await vault.listNotebooks()) {
      if (old.topic === "React 项目上手" || old.topic === "线性代数入门") await vault.deleteNotebook(old.id);
    }
    const draft: OutlineDraft = {
      type: "outline",
      assumption: "按“能读懂矩阵并用特征值解释现象”收敛，砍掉数值算法与证明细节",
      scope_one_line: "能读懂矩阵运算，并用特征值与特征向量解释一个实际现象",
      chapters: [
        {
          id: "01",
          title: "向量与空间",
          goal: "能在坐标系里说清向量、基与坐标的关系",
          sections: [
            { id: "1.1", title: "向量、基与坐标", goal: "把一个向量用一组基表示出来" },
            { id: "1.2", title: "线性相关与张成", goal: "判断一组向量是否张成整个空间" },
          ],
        },
        {
          id: "02",
          title: "矩阵与线性变换",
          goal: "能把矩阵看成对空间的一次变换",
          sections: [
            { id: "2.1", title: "矩阵乘法与线性变换", goal: "写出旋转与投影对应的矩阵" },
            { id: "2.2", title: "秩、核与像", goal: "用秩判断方程组解的结构" },
          ],
        },
        {
          id: "03",
          title: "特征值与对角化",
          goal: "能用特征值解释长期行为",
          sections: [
            { id: "3.1", title: "特征值与特征向量", goal: "手算二阶矩阵的特征值" },
            { id: "3.2", title: "对角化与应用", goal: "判断矩阵能否对角化并解释幂迭代" },
          ],
        },
      ],
      coverage_gaps: ["没有覆盖数值线性代数：与入门目标无关，留作后续"],
      sources: [],
    };
    const nb = await vault.createNotebookFromOutline({
      topic: "线性代数入门",
      draft,
      style: "feynman",
      webSearch: false,
      title: "线性代数：从向量到特征值",
    });
    const sample = nb.nodes.find((n) => n.title === "向量、基与坐标");
    if (sample) {
      const body = `## 为什么先学向量\n\n线性代数里所有东西，最后都落回“一堆数怎么组合”。先在平面上把这件事看清，矩阵和特征值才有地方挂。\n\n## 它是什么\n\n- 向量：既有大小又有方向的量，在坐标里就是一列数；\n- 基：一组“尺子”，任何向量都能用它们量出来；\n- 坐标：同一个向量换一组基，坐标会变，向量本身不变。\n\n## 怎么做\n\n1. 取 e₁=(1,0)、e₂=(0,1) 作为二维标准基；\n2. 把 v=(3,2) 写成 3e₁+2e₂，坐标就是 (3,2)；\n3. 换一组基 b₁=(1,1)、b₂=(1,-1)，设 v=a·b₁+b·b₂；\n4. 解得 a=2.5、b=0.5——坐标变了，向量没变。\n\n## 什么时候会坏\n\n- 基里混进零向量或两个向量共线：量不出整个平面，坐标不唯一；\n- 忘了“基必须线性无关”：解方程会出现自由变量，坐标随便填都对。\n\n## 自检\n\n给你一组基和一个向量，能独立解出坐标，并说清“变的是坐标，不是向量”，这一节就算过了。`;
      await vault.putNodeBody(nb.id, sample.id, body);
      await vault.updateNode(nb.id, sample.id, { status: "done" });

      // 示例组件页：闪卡 / 速查表，用固定 JSON，不调用模型
      const demoPages: Array<{ kind: "flashcards" | "glossary"; title: string; data: unknown }> = [
        {
          kind: "flashcards",
          title: "向量、基与坐标 · 闪卡",
          data: {
            type: "flashcards",
            title: "向量、基与坐标 · 闪卡",
            items: [
              {
                id: "fc-1",
                tag: "1.1",
                front: "两个向量线性相关，几何上意味着什么？",
                back: "它们共线（成比例），只张成一条过原点的直线，不能构成平面的一组基。",
                example: "(1,2) 与 (2,4)：后者是前者的 2 倍，向量组秩为 1。",
              },
              {
                id: "fc-2",
                tag: "1.1",
                front: "同一个向量换一组基，什么变了、什么没变？",
                back: "坐标变了，向量本身没变；坐标只是这组基下的读数。",
                example: "v=(3,2) 在标准基下是 (3,2)，在 b₁=(1,1)、b₂=(1,-1) 下是 (2.5,0.5)。",
              },
              {
                id: "fc-3",
                tag: "1.1",
                front: "为什么一组基里的向量必须线性无关？",
                back: "有相关向量就有一个方向多余，张成的空间维度不够，坐标表示不唯一。",
                example: "平面里取两条共线向量，只能张成一条直线；取三条就必有一组不独立。",
              },
            ],
          },
        },
        {
          kind: "glossary",
          title: "向量、基与坐标 · 速查表",
          data: {
            type: "glossary",
            title: "向量、基与坐标 · 速查表",
            items: [
              { id: "g-1", kind: "term", term: "基", en: "basis", definition: "一组线性无关、能张成整个空间的向量。", sectionRef: "1.1" },
              { id: "g-2", kind: "term", term: "张成", en: "span", definition: "一组向量全部线性组合得到的集合。", sectionRef: "1.2" },
              { id: "g-3", kind: "term", term: "秩", en: "rank", definition: "向量组中线性无关向量的最大个数，等于张成空间的维数。", sectionRef: "1.2" },
            ],
          },
        },
      ];
      for (const p of demoPages) {
        const page = await vault.addNode(nb.id, {
          parentId: sample.id,
          title: p.title,
          kind: "page",
          pageKind: p.kind,
          createdBy: "ai",
        });
        await vault.putNodeBody(nb.id, page.id, JSON.stringify(p.data, null, 2));
        await vault.updateNode(nb.id, page.id, { status: "done" });
      }
    }
    const fresh = await vault.loadNotebook(nb.id);
    set({ screen: { name: "notebook", nbId: nb.id }, nb: fresh, tabs: [MINDMAP_TAB], activeTabId: "mindmap", bodies: {} });
    await get().refreshNotebooks();
  },

  saveModel: async (m, makeDefault) => {
    const settings = await getVault().addModel(m, makeDefault);
    set({ settings });
  },

  removeModel: async (id) => {
    const settings = await getVault().removeModel(id);
    set({ settings });
  },

  setDefaultModel: async (id) => {
    const settings = await getVault().setDefaultModel(id);
    set({ settings });
  },

  toggleWebSearch: async () => {
    const settings = await getVault().setWebSearch(!get().settings.webSearch);
    set({ settings });
  },

  selectTab: (id) => set({ activeTabId: id }),

  closeTab: (id) => {
    if (id === "mindmap") return;
    const tabs = get().tabs.filter((t) => t.id !== id);
    const active = get().activeTabId;
    let nextActive = active;
    if (active === id) {
      const idx = get().tabs.findIndex((t) => t.id === id);
      const fallback = get().tabs[idx - 1] ?? get().tabs[idx + 1] ?? MINDMAP_TAB;
      nextActive = fallback.id;
    }
    set({ tabs, activeTabId: nextActive });
  },

  openNode: async (nodeId) => {
    const { nb } = get();
    if (!nb) return;
    const node = nb.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    const existing = get().tabs.find((t) => t.nodeId === nodeId);
    if (existing) {
      set({ activeTabId: existing.id, mindmapCurrentId: nodeId });
      return;
    }
    const tab: Tab = {
      id: `tab:${nodeId}`,
      nodeId,
      title: node.title,
      kind: node.kind === "page" ? "page" : "note",
    };
    set({ tabs: [...get().tabs, tab], activeTabId: tab.id, mindmapCurrentId: nodeId });
    await get().ensureBody(nodeId);
  },

  renameNode: async (nodeId, title) => {
    const nb = get().nb;
    const clean = title.trim();
    if (!nb || !clean) return;
    await getVault().renameNode(nb.id, nodeId, clean);
    const fresh = await getVault().loadNotebook(nb.id);
    if (!fresh) return;
    set((s) => ({
      nb: fresh,
      tabs: s.tabs.map((t) => (t.nodeId === nodeId ? { ...t, title: clean } : t)),
    }));
  },

  addChildNode: async (parentId, title) => {
    const nb = get().nb;
    const clean = title.trim();
    if (!nb || !clean) return;
    const parent = nb.nodes.find((n) => n.id === parentId);
    await getVault().addNode(nb.id, {
      parentId,
      title: clean,
      kind: parent?.kind === "root" ? "chapter" : "section",
      createdBy: "user",
    });
    const fresh = await getVault().loadNotebook(nb.id);
    if (fresh) set({ nb: fresh });
    await get().refreshNotebooks();
  },

  deleteNode: async (nodeId) => {
    const nb = get().nb;
    if (!nb) return;
    await getVault().removeNode(nb.id, nodeId);
    const fresh = await getVault().loadNotebook(nb.id);
    if (!fresh) return;
    const alive = new Set(fresh.nodes.map((n) => n.id));
    const tabs = get().tabs.filter((t) => !t.nodeId || alive.has(t.nodeId));
    const activeTabId = tabs.some((t) => t.id === get().activeTabId) ? get().activeTabId : "mindmap";
    set({ nb: fresh, tabs, activeTabId, bodies: {} });
    await get().refreshNotebooks();
  },

  ensureBody: async (nodeId) => {
    const { nb, bodies } = get();
    if (!nb || bodies[nodeId] !== undefined) return;
    const node = nb.nodes.find((n) => n.id === nodeId);
    if (node?.status !== "done") {
      set({ bodies: { ...get().bodies, [nodeId]: "" } });
      return;
    }
    const text = await getVault().getNodeBody(nb.id, nodeId);
    set({ bodies: { ...get().bodies, [nodeId]: text } });
  },

  saveBody: async (nodeId, markdown) => {
    const { nb } = get();
    if (!nb) return;
    await getVault().putNodeBody(nb.id, nodeId, markdown);
    const fresh = await getVault().loadNotebook(nb.id);
    set({ nb: fresh, bodies: { ...get().bodies, [nodeId]: markdown } });
  },

  generateNode: async (nodeId) => {
    const { nb, generating } = get();
    if (!nb || generating[nodeId]) return;
    const vault = getVault();
    set({ generating: { ...get().generating, [nodeId]: true }, error: null });
    set({ bodies: { ...get().bodies, [nodeId]: "" } });
    set({ nb: await vault.updateNode(nb.id, nodeId, { status: "running" }) });
    try {
      const d = deps(get().settings, nb.defaultModelId);
      const node = nb.nodes.find((n) => n.id === nodeId);
      const webPages = nb.webSearch ? await searchWeb(`${nb.title} ${node?.title ?? ""}`.trim(), 4) : [];
      let text = "";
      let cites: number[] = [];
      for await (const ev of streamNodeContent(vault, nb, nodeId, d, { requirement: nb.assumption, webPages })) {
        if (ev.type === "delta") {
          text += ev.text;
          set({ bodies: { ...get().bodies, [nodeId]: text } });
        } else if (ev.type === "done") {
          cites = ev.cites;
        }
      }
      await vault.putNodeBody(nb.id, nodeId, text, { cites });
      const local = collectReadSources(nb, nodeId);
      const sources = [
        ...local,
        ...webPages.map((p, i) => ({
          id: local.length + i + 1,
          kind: "web" as const,
          title: p.title,
          url: p.url,
        })),
      ];
      const fresh = await vault.updateNode(nb.id, nodeId, { status: "done", sources });
      set({ nb: fresh, bodies: { ...get().bodies, [nodeId]: text } });
    } catch (err) {
      set({
        nb: await vault.updateNode(nb.id, nodeId, { status: "failed" }),
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      const g = { ...get().generating };
      delete g[nodeId];
      set({ generating: g });
      await get().refreshNotebooks();
    }
  },

  generateRange: async (nodeId) => {
    const { nb } = get();
    if (!nb) return;
    const node = nb.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    const pickTargets = (root: Node): Node[] => {
      const out: Node[] = [];
      const walk = (n: Node) => {
        // 组件页是独立 JSON 生成，不参与正文批量生成
        if (n.kind !== "page" && n.status !== "done") out.push(n);
        nb.nodes.filter((c) => c.parentId === n.id).forEach(walk);
      };
      walk(root);
      return out;
    };
    const targets = pickTargets(node);
    // 并行跑：每篇各自组装上下文、各自流式落盘；并发上限统一由 GEN_CONCURRENCY 控制
    const queue = targets.filter((t) => !get().generating[t.id]);
    await runPool(queue, GEN_CONCURRENCY, async (item) => {
      // 二次确认：排队期间可能已被别处生成或已完成
      if (get().generating[item.id]) return;
      await get().generateNode(item.id);
    });
    // 并行的多个回调各自拿的是写入时刻的快照，最后统一回读一次，避免状态栏卡在「生成中」
    const cur = get().nb;
    if (cur) set({ nb: (await getVault().loadNotebook(cur.id)) ?? cur });
  },

  generatePage: async (nodeId, kind) => {
    const { nb } = get();
    if (!nb) return;
    const vault = getVault();
    const node = nb.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    set({ error: null });
    const existing = nb.nodes.find(
      (n) => n.parentId === nodeId && n.kind === "page" && n.pageKind === kind,
    );
    const pageId = existing
      ? existing.id
      : (
          await vault.addNode(nb.id, {
            parentId: nodeId,
            title: `${node.title} · ${pick(get().settings.language, COMPONENT_LABEL[kind].zh, COMPONENT_LABEL[kind].en)}`,
            kind: "page",
            pageKind: kind,
            createdBy: "ai",
          })
        ).id;
    set({ generating: { ...get().generating, [pageId]: true } });
    await vault.updateNode(nb.id, pageId, { status: "running" });
    set({ nb: await vault.loadNotebook(nb.id) });
    // 立刻把这一页切到前台，让用户看到「正在生成组件…」而不是以为点了没反应
    await get().openNode(pageId);
    try {
      const current = get().nb ?? nb;
      const d = deps(get().settings, nb.defaultModelId);
      const ctx = await collectNodeContext(vault, current, nodeId);
      const ctxText = contextBlock(ctx);
      const scopeLabel =
        node.kind === "root"
          ? `全本：${nb.title}`
          : node.kind === "chapter"
            ? `本章：${node.title}`
            : `本节：${node.title}`;
      const goal = node.goal ?? nb.scope ?? "";
      const path = nodePathOf(nb, nodeId);
      let data: unknown;
      if (kind === "flashcards") {
        data = await generateComponent(d, "component-flashcards", {
          source_scope: scopeLabel,
          count: "10",
          path,
          goal,
        }, ctxText);
      } else {
        const excerpt = ctx.pages.map((p) => `${p.title}\n${p.text}`).join("\n\n").slice(0, 8000);
        data = await generateComponent(d, "component-glossary", {
          scope: scopeLabel,
          path,
          body_excerpt: excerpt,
        }, ctxText);
      }
      if (!data || typeof data !== "object" || !Array.isArray((data as { items?: unknown[] }).items)) {
        throw new Error(pick(get().settings.language, "组件返回格式不正确，请重试", "The component came back in an unexpected format. Try again."));
      }
      const json = JSON.stringify(data, null, 2);
      await vault.putNodeBody(nb.id, pageId, json);
      set({ nb: await vault.updateNode(nb.id, pageId, { status: "done" }) });
      set({ bodies: { ...get().bodies, [pageId]: json } });
    } catch (err) {
      await vault.updateNode(nb.id, pageId, { status: "failed" });
      set({
        nb: await vault.loadNotebook(nb.id),
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      const g = { ...get().generating };
      delete g[pageId];
      set({ generating: g });
    }
  },

  addAttachments: async (nodeId, files) => {
    const { nb } = get();
    if (!nb || files.length === 0) return;
    const vault = getVault();
    set({ error: null });
    try {
      for (const file of files) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const att = await vault.saveAttachment(nb.id, { name: file.name, bytes }, true);
        await vault.attachToNode(nb.id, nodeId, att);
      }
      set({ nb: await vault.loadNotebook(nb.id) });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  toggleAttachmentInherit: async (nodeId, attachmentId) => {
    const { nb } = get();
    if (!nb) return;
    const node = nb.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    const attachments = (node.attachments ?? []).map((a) =>
      a.id === attachmentId ? { ...a, inherit: !a.inherit } : a,
    );
    set({
      nb: await getVault().updateNode(nb.id, nodeId, { attachments }),
    });
  },

  removeAttachmentById: async (nodeId, attachmentId) => {
    const { nb } = get();
    if (!nb) return;
    await getVault().removeAttachment(nb.id, nodeId, attachmentId);
    set({ nb: (await getVault().loadNotebook(nb.id)) ?? nb });
  },

  /** 导出 Markdown；scope=chapter 时只导出某一章的子树，高亮作为附录写在每节末尾 */
  exportNotebook: async (scope = "book", chapterId) => {
    const nb = get().nb;
    if (!nb) return;
    try {
      const view = await buildExportView(getVault(), nb, scope, chapterId, get().settings.language ?? "zh");
      const title = scope === "chapter" && view.root ? `${nb.title} · ${view.root.title}` : nb.title;
      const lines: string[] = [`# ${title}`, ""];
      if (nb.scope) lines.push(`> ${nb.scope}`, "");
      for (const s of view.sections) {
        lines.push(`${"#".repeat(Math.min(6, s.level + 1))} ${s.title}`, "");
        lines.push(s.body || pick(get().settings.language, "（未生成）", "(not generated)"), "");
        if (s.highlights?.length) {
          lines.push(pick(get().settings.language, "**我的高亮**", "**My highlights**"), "");
          for (const h of s.highlights) lines.push(`- ${h.text}`);
          lines.push("");
        }
      }
      const safe = title.replace(/[\\/:*?"<>|]/g, "_");
      const path = await saveExportFile(`${safe}.md`, new TextEncoder().encode(lines.join("\n")));
      set({ notice: `已导出 Markdown：${path}`, exportPath: path });
    } catch (err) {
      set({ error: `导出失败：${err instanceof Error ? err.message : String(err)}` });
    }
  },

  setSelection: (text) => set({ selection: text }),

  setChatOpen: (open) => set({ chatOpen: open }),

  setChatScope: async (scope) => {
    set({ chatScope: scope });
    const nb = get().nb;
    if (!nb) return;
    await buildChatScope(getVault(), nb, activeNodeId(get()), scope);
  },

  setChatModel: (id) => set({ chatModelId: id }),

  clearChat: () => {
    if (get().chatBusy) return;
    const key = chatNodeKey(get());
    const sessionId = newSessionId();
    set({
      chat: get().chat.filter((m) => (m.nodeId ?? "root") !== key),
      selection: null,
      chatSessionId: sessionId,
      nodeSessionIds: { ...get().nodeSessionIds, [key]: sessionId },
    });
  },

  refreshChatSessions: async () => {
    const nb = get().nb;
    if (!nb) return;
    const entries = await getVault().loadChat(nb.id);
    const groups = new Map<string, { title: string; at: string; rounds: number; nodeId: string }>();
    for (const e of entries) {
      const nodeId = e.nodeId ?? "root";
      const sid = e.sessionId ?? "legacy";
      const gKey = `${nodeId}\u0000${sid}`;
      const g = groups.get(gKey) ?? { title: "", at: e.createdAt, rounds: 0, nodeId };
      if (e.role === "assistant") {
        g.rounds += 1;
        if (!g.title && e.question) g.title = e.question;
      }
      g.at = e.createdAt;
      groups.set(gKey, g);
    }
    set({
      chatSessions: [...groups.entries()]
        .map(([gKey, g]) => ({
          id: gKey.slice(gKey.indexOf("\u0000") + 1),
          title: g.title || pick(get().settings.language, "历史对话", "Past conversation"),
          at: g.at,
          rounds: g.rounds,
          nodeId: g.nodeId,
        }))
        .sort((a, b) => b.at.localeCompare(a.at)),
    });
  },

  openChatSession: async (sessionId) => {
    const nb = get().nb;
    if (!nb) return;
    const key = chatNodeKey(get());
    const entries = (await getVault().loadChat(nb.id)).filter(
      (e) =>
        (e.nodeId ?? "root") === key &&
        (sessionId === "legacy" ? !e.sessionId : e.sessionId === sessionId),
    );
    const messages: ChatMessageView[] = [];
    for (const e of entries) {
      if (e.role === "user") {
        messages.push({ id: e.id, role: "user", content: e.content, nodeId: key });
      } else {
        if (e.question) messages.push({ id: `${e.id}-q`, role: "user", content: e.question, nodeId: key });
        messages.push({ id: e.id, role: "assistant", content: e.content, question: e.question, nodeId: key });
      }
    }
    set({
      chat: [...get().chat.filter((m) => (m.nodeId ?? "root") !== key), ...messages],
      chatSessionId: sessionId,
      nodeSessionIds: { ...get().nodeSessionIds, [key]: sessionId },
      selection: null,
    });
  },

  saveChatAsNote: async (content) => {
    const { nb } = get();
    if (!nb || !content.trim()) return;
    const vault = getVault();
    const active = activeNodeId(get());
    const node = active ? nb.nodes.find((n) => n.id === active) : undefined;
    const parentId = !node
      ? nb.nodes.find((n) => n.kind === "root")?.id
      : node.kind === "section" || node.kind === "page"
        ? node.parentId ?? node.id
        : node.id;
    if (!parentId) return;
    const title = noteTitle(content, get().settings.language ?? "zh");
    const created = await vault.addNode(nb.id, { parentId, title, kind: "section", createdBy: "user" });
    await vault.putNodeBody(nb.id, created.id, content);
    await vault.updateNode(nb.id, created.id, { status: "done" });
    const fresh = await vault.loadNotebook(nb.id);
    if (fresh) set({ nb: fresh, bodies: { ...get().bodies, [created.id]: content } });
    await get().openNode(created.id);
  },

  setTheme: async (theme) => {
    const vault = getVault();
    const settings = await vault.getSettings();
    const next = { ...settings, theme };
    await vault.saveSettings(next);
    set({ settings: next });
  },

  setLanguage: async (language) => {
    const settings = await getVault().setLanguage(language);
    set({ settings });
  },

  // ------------------------------------------------------- 高亮 / 结构

  addHighlight: async (nodeId, text) => {
    const nb = get().nb;
    if (!nb) return;
    const node = nb.nodes.find((n) => n.id === nodeId);
    const clean = text.replace(/\s+/g, " ").trim().slice(0, 600);
    if (!node || !clean) return;
    const cur = node.highlights ?? [];
    if (cur.some((h) => h.text === clean)) return;
    const item: Highlight = {
      id: newId("h"),
      text: clean,
      createdAt: nowIso(),
    };
    set({ nb: await getVault().updateNode(nb.id, nodeId, { highlights: [...cur, item] }) });
  },

  removeHighlight: async (nodeId, id) => {
    const nb = get().nb;
    if (!nb) return;
    const node = nb.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    const highlights = (node.highlights ?? []).filter((h) => h.id !== id);
    set({ nb: await getVault().updateNode(nb.id, nodeId, { highlights }) });
  },

  reorderNode: async (nodeId, toIndex) => {
    const nb = get().nb;
    if (!nb) return;
    await getVault().reorderNode(nb.id, nodeId, toIndex);
    set({ nb: (await getVault().loadNotebook(nb.id)) ?? nb });
  },

  moveNode: async (nodeId, newParentId) => {
    const nb = get().nb;
    if (!nb) return;
    await getVault().moveNode(nb.id, nodeId, newParentId);
    set({
      nb: (await getVault().loadNotebook(nb.id)) ?? nb,
      notice: pick(get().settings.language, "已移动到新的层级。", "Moved to the new level."),
    });
  },

  restructureNode: async (scopeNodeId, instruction) => {
    const nb = get().nb;
    if (!nb || !instruction.trim()) return "";
    const vault = getVault();
    const scopeNode = scopeNodeId ? nb.nodes.find((n) => n.id === scopeNodeId) : undefined;
    const scopeIds = scopeNode ? subtreeIds(nb, scopeNode.id) : new Set(nb.nodes.map((n) => n.id));
    const scoped = nb.nodes.filter((n) => scopeIds.has(n.id) && n.kind !== "page");
    const locked = nb.nodes.filter((n) => scopeIds.has(n.id) && n.status === "done" && n.kind !== "page").map((n) => n.id);
    const structureJson = JSON.stringify(
      scoped.map((n) => ({
        id: n.id,
        parentId: n.parentId,
        kind: n.kind,
        title: n.title,
        goal: n.goal ?? "",
        status: n.status,
        order: n.order,
      })),
      null,
      2,
    );
    const d = deps(get().settings, nb.defaultModelId);
    let patch;
    try {
      patch = await restructureOutline(d, {
        scope: scopeNode ? "chapter" : "book",
        structureJson,
        instruction,
        lockedIds: locked,
      });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return "";
    }
    if (patch.rejected) {
      set({ notice: `未应用：${patch.rejected}` });
      return patch.rejected;
    }
    const applied: string[] = [];
    let warning = patch.one_line_warning ?? "";
    for (const op of patch.ops ?? []) {
      try {
        if (op.op === "rename") {
          if (!scopeIds.has(op.id) || !op.title?.trim()) continue;
          await vault.renameNode(nb.id, op.id, op.title.trim());
          applied.push(pick(get().settings.language, `改名「${op.title.trim()}」`, `renamed to “${op.title.trim()}”`));
          if (locked.includes(op.id)) warning = `${warning ? `${warning} ` : ""}${pick(get().settings.language, `「${op.title.trim()}」标题已改，正文保持原样。`, `“${op.title.trim()}” was renamed; its body is unchanged.`)}`;
        } else if (op.op === "add") {
          const parent = op.parentId ? nb.nodes.find((n) => n.id === op.parentId) : undefined;
          if (!parent || !op.title?.trim()) continue;
          const kind = parent.kind === "chapter" ? "section" : parent.kind === "root" ? "chapter" : "section";
          const created = await vault.addNode(nb.id, {
            parentId: parent.id,
            title: op.title.trim(),
            kind,
            createdBy: "ai",
          });
          if (op.goal) await vault.updateNode(nb.id, created.id, { goal: op.goal });
          applied.push(pick(get().settings.language, `新增「${op.title.trim()}」`, `added “${op.title.trim()}”`));
        } else if (op.op === "move") {
          if (locked.includes(op.id)) {
            warning = `${warning ? `${warning} ` : ""}${pick(get().settings.language, "已生成正文的节点不能移动。", "Nodes that already have body text cannot be moved.")}`;
            continue;
          }
          if (!op.parentId) continue;
          await vault.moveNode(nb.id, op.id, op.parentId);
          if (op.afterId) {
            const siblings = ((await vault.loadNotebook(nb.id))?.nodes ?? [])
              .filter((n) => n.parentId === op.parentId)
              .sort((a, b) => a.order - b.order);
            const idx = siblings.findIndex((n) => n.id === op.afterId);
            if (idx >= 0) await vault.reorderNode(nb.id, op.id, idx + 1);
          }
          applied.push(pick(get().settings.language, "调整顺序", "reorder"));
        } else if (op.op === "remove") {
          if (locked.includes(op.id)) {
            warning = `${warning ? `${warning} ` : ""}${pick(get().settings.language, "已生成正文的节点不能删除。", "Nodes that already have body text cannot be deleted.")}`;
            continue;
          }
          if (scopeIds.has(op.id) && nb.nodes.find((n) => n.id === op.id)?.kind !== "root") {
            await vault.removeNode(nb.id, op.id);
            applied.push(pick(get().settings.language, "删除节点", "delete node"));
          }
        }
      } catch {
        // 单条补丁失败不影响其他操作
      }
    }
    const fresh = await vault.loadNotebook(nb.id);
    if (fresh) set({ nb: fresh, bodies: {} });
    const msg = applied.length
      ? pick(
          get().settings.language,
          `已应用 ${applied.length} 处结构修改${warning ? `；${warning}` : ""}`,
          `Applied ${applied.length} structure change(s)${warning ? `; ${warning}` : ""}`,
        )
      : pick(get().settings.language, "没有可应用的结构修改", "No structure changes to apply");
    set({ notice: msg });
    return msg;
  },

  generateCustomPage: async (request) => {
    const nb = get().nb;
    if (!nb || !request.trim()) return;
    const vault = getVault();
    const active = activeNodeId(get());
    const cur = active ? nb.nodes.find((n) => n.id === active) : undefined;
    const anchor =
      cur && cur.kind !== "page"
        ? cur
        : cur?.parentId
          ? nb.nodes.find((n) => n.id === cur.parentId) ?? nb.nodes.find((n) => n.kind === "root")
          : nb.nodes.find((n) => n.kind === "root");
    if (!anchor) return;
    set({ error: null, notice: pick(get().settings.language, "正在生成自定义页…", "Generating a custom page…") });
    try {
      const ctx = await collectNodeContext(vault, nb, anchor.id);
      const ctxText = contextBlock(ctx);
      const attachments = [
        ...ctx.rootFiles.map((f) => f.name),
        ...ctx.nodeAttachments.map((f) => f.name),
        ...ctx.ancestorAttachments.map((f) => f.name),
      ];
      const structureHint = nb.nodes
        .filter((n) => n.kind !== "page")
        .sort((a, b) => a.order - b.order)
        .map((n) => `${n.id} · ${nodePathOf(nb, n.id)}`)
        .join("\n");
      const lang = get().settings.language;
      const scopeLabel =
        anchor.kind === "root"
          ? pick(lang, `全本：${nb.title}`, `Whole book: ${nb.title}`)
          : anchor.kind === "chapter"
            ? pick(lang, `本章：${anchor.title}`, `Chapter: ${anchor.title}`)
            : pick(lang, `本节：${anchor.title}`, `Section: ${anchor.title}`);
      const d = deps(get().settings, nb.defaultModelId);
      const res = await generateCustomPageCore(d, {
        request,
        scope: scopeLabel,
        attachments,
        structureHint,
        context: ctxText,
      });
      const type = res.type ?? "note";
      const pageKind: Node["pageKind"] =
        type === "flashcards" || type === "glossary" ? type : "custom";
      const parent =
        res.suggested_parent && nb.nodes.some((n) => n.id === res.suggested_parent)
          ? nb.nodes.find((n) => n.id === res.suggested_parent)!
          : anchor;
      const title = res.title?.trim().slice(0, 24) || pick(get().settings.language, "AI 定制页", "AI custom page");
      let body: string;
      if (pageKind === "custom") {
        body = String((res.content as { markdown?: string })?.markdown ?? "");
        if (!body.trim())
          throw new Error(pick(get().settings.language, "模型没有返回可用的页面内容", "The model returned no usable page content."));
      } else {
        const items = (res.content as { items?: unknown[] })?.items;
        if (!Array.isArray(items) || !items.length)
          throw new Error(pick(get().settings.language, "模型没有返回可用的组件条目", "The model returned no usable component items."));
        body = JSON.stringify({ type: pageKind, title, items }, null, 2);
      }
      const created = await vault.addNode(nb.id, {
        parentId: parent.id,
        title,
        kind: "page",
        pageKind,
        createdBy: "user",
      });
      await vault.putNodeBody(nb.id, created.id, body);
      const sources = collectReadSources(nb, parent.id);
      await vault.updateNode(nb.id, created.id, { status: "done", sources });
      set({
        nb: await vault.loadNotebook(nb.id),
        bodies: { ...get().bodies, [created.id]: body },
        notice: pick(
          get().settings.language,
          `已生成「${title}」${res.missing?.length ? `（缺：${res.missing.join("、")}）` : ""}`,
          `Created “${title}”${res.missing?.length ? ` (missing: ${res.missing.join(", ")})` : ""}`,
        ),
      });
      await get().openNode(created.id);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), notice: null });
    }
  },

  // ------------------------------------------------------------ 导出 / 导入

  exportArchive: async (scope = "book", chapterId) => {
    const nb = get().nb;
    if (!nb) return;
    const vault = getVault();
    try {
      const view = await buildExportView(vault, nb, scope, chapterId, get().settings.language ?? "zh");
      const outNb: Notebook =
        scope === "chapter" && view.root
          ? {
              ...nb,
              title: `${nb.title} · ${view.root.title}`,
              scope: view.root.goal ?? nb.scope,
              nodes: [{ ...view.root, kind: "root", parentId: null, order: 0 }, ...view.nodes.filter((n) => n.id !== view.root!.id)],
            }
          : nb;
      const entries = [];
      for (const node of outNb.nodes) {
        const raw = await vault.getRawText(P.nodeFile(nb.id, node.id));
        if (raw) entries.push(makeTextEntry(`nodes/${node.id}.md`, raw));
      }
      // 附件路径改写成包内扁平路径，导入时再落到新笔记本目录
      const fileEntries = new Map<string, Uint8Array>();
      const nodesForArchive = outNb.nodes.map((n) => ({
        ...n,
        attachments: (n.attachments ?? []).map((a) => {
          const base = a.path.split("/").pop() ?? `${a.id}-${a.name}`;
          return { ...a, path: `files/${base}` };
        }),
      }));
      for (const node of outNb.nodes) {
        for (const a of node.attachments ?? []) {
          const base = a.path.split("/").pop() ?? `${a.id}-${a.name}`;
          if (fileEntries.has(`files/${base}`)) continue;
          try {
            fileEntries.set(`files/${base}`, await vault.getRawBinary(a.path));
          } catch {
            // 附件缺失不阻塞归档主体
          }
        }
      }
      for (const [path, data] of fileEntries) entries.push({ path, data });
      const archiveNotebook: Notebook = { ...outNb, nodes: nodesForArchive };
      const chat = scope === "book" ? await vault.loadChat(nb.id) : [];
      entries.push(
        makeTextEntry(
          "data.json",
          JSON.stringify(
            {
              format: "axonota-archive",
              version: 1,
              scope,
              exportedAt: nowIso(),
              notebook: archiveNotebook,
              bodies: view.bodies,
              chat,
            },
            null,
            2,
          ),
        ),
      );
      const scopeName = scope === "chapter"
        ? pick(get().settings.language, "单章", "single chapter")
        : pick(get().settings.language, "整本", "full notebook");
      entries.push(
        makeTextEntry(
          "README.md",
          `# ${archiveNotebook.title}\n\n${pick(get().settings.language, `Axonota 归档（${scopeName}）。`, `Axonota archive (${scopeName}).`)}\n- ${pick(get().settings.language, "结构、正文、附件、高亮都在 data.json 与 nodes/ 中。", "Structure, body text, attachments and highlights live in data.json and nodes/.")}\n- ${pick(get().settings.language, "可在 Axonota 的「导入 zip」中重新打开。", "Reopen it with “Import zip” in Axonota.")}\n`,
        ),
      );
      const safeTitle = (archiveNotebook.title || "Axonota").replace(/[\\/:*?"<>|]/g, "_");
      const path = await saveExportFile(`${safeTitle}${scope === "chapter" ? pick(get().settings.language, "（单章）", " (chapter)") : ""}.zip`, buildZip(entries));
      set({ notice: `${pick(get().settings.language, "已导出 zip：", "Exported zip: ")}${path}`, exportPath: path });
    } catch (err) {
      set({ error: `${pick(get().settings.language, "导出失败：", "Export failed: ")}${err instanceof Error ? err.message : String(err)}` });
    }
  },

  importArchive: async (file) => {
    const vault = getVault();
    try {
      const entries = readZip(new Uint8Array(await file.arrayBuffer()));
      const raw = textEntry(entries, "data.json");
      if (!raw) throw new Error(pick(get().settings.language, "归档里没有 data.json，可能不是 Axonota 导出的 zip", "The archive has no data.json; it may not be a zip exported by Axonota."));
      const data = JSON.parse(raw) as {
        format?: string;
        notebook?: Notebook;
        bodies?: Record<string, string>;
        chat?: ChatEntry[];
      };
      if (data.format !== "axonota-archive" || !data.notebook) throw new Error(pick(get().settings.language, "归档格式不受支持", "Unsupported archive format."));
      const src = data.notebook;
      const oldId = src.id;
      const nbId = newId("nb");
      const idMap = new Map<string, string>();
      for (const n of src.nodes) idMap.set(n.id, newId("n"));
      const nodes: Node[] = src.nodes.map((n) => ({
        ...n,
        id: idMap.get(n.id) ?? newId("n"),
        parentId: n.parentId ? idMap.get(n.parentId) ?? null : null,
        attachments: (n.attachments ?? []).map((a) => {
          const base = a.path.split("/").pop() ?? `${a.id}-${a.name}`;
          return { ...a, path: `${P.filesDir(nbId)}/${base}` };
        }),
        highlights: n.highlights ?? [],
        updatedAt: nowIso(),
      }));
      const nb: Notebook = {
        ...src,
        id: nbId,
        nodes,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      await vault.saveNotebook(nb);
      for (const oldNode of src.nodes) {
        const newIdv = idMap.get(oldNode.id);
        if (!newIdv) continue;
        const body = (data.bodies ?? {})[oldNode.id] ?? textEntry(entries, `nodes/${oldNode.id}.md`);
        if (!body) continue;
        const fixed = oldId && oldId !== nbId ? body.split(oldId).join(nbId) : body;
        await vault.putNodeBody(nbId, newIdv, fixed);
      }
      for (const n of nodes) {
        for (const a of n.attachments) {
          const base = a.path.split("/").pop() ?? "";
          const hit = entries.find((e) => e.path === `files/${base}`);
          if (hit) await vault.writeRawBinary(a.path, hit.data);
        }
      }
      if (data.chat?.length) {
        await vault.writeRawText(
          P.chatFile(nbId),
          data.chat.map((c) => JSON.stringify(c)).join("\n") + "\n",
        );
      }
      await get().refreshNotebooks();
      await get().openNotebook(nbId);
      set({ notice: `已导入「${nb.title}」` });
    } catch (err) {
      set({ error: `导入失败：${err instanceof Error ? err.message : String(err)}` });
    }
  },

  exportPdf: async (scope = "book", chapterId) => {
    const nb = get().nb;
    if (!nb) return;
    try {
      const view = await buildExportView(getVault(), nb, scope, chapterId, get().settings.language ?? "zh");
      const title = scope === "chapter" && view.root ? `${nb.title} · ${view.root.title}` : nb.title;
      const sections = view.sections.map((s) => ({
        title: s.title,
        level: s.level,
        body: s.body,
        highlights: s.highlights,
      }));
      const highlights = view.nodes.flatMap((n) => n.highlights ?? []);
      const lang = get().settings.language ?? "zh";
      printHtml(
        buildPrintHtml({
          title,
          topic: nb.topic,
          scope: nb.scope,
          generatedAt: new Date().toLocaleDateString(lang === "en" ? "en-US" : "zh-CN"),
          sections,
          highlights,
          lang,
        }),
        lang,
      );
      set({ notice: pick(get().settings.language, "已打开打印窗口；在系统打印里选择「另存为 PDF」即可得到 PDF。", "The print window is open; choose “Save as PDF” in the system print dialog to get a PDF.") });
    } catch (err) {
      set({ error: `${pick(get().settings.language, "导出 PDF 失败：", "PDF export failed: ")}${err instanceof Error ? err.message : String(err)}` });
    }
  },

  sendChat: async (question, uploads) => {
    const { nb, activeTabId, tabs } = get();
    if (!nb) return;
    const vault = getVault();
    const tab = tabs.find((t) => t.id === activeTabId);
    const nodeId = tab?.nodeId ?? null;
    const scope = get().chatScope;
    const selectedText = get().selection ?? undefined;
    const attached = uploads?.length ? `\n\n附件：${uploads.map((u) => u.name).join("、")}` : "";
    const key = chatNodeKey(get());
    const sessionId = get().nodeSessionIds[key] ?? newSessionId();
    const userMsg: ChatMessageView = {
      id: `u${Date.now()}`,
      role: "user",
      content: (selectedText ? `「${selectedText.slice(0, 80)}」\n${question}` : question) + attached,
      nodeId: key,
    };
    const aiId = `a${Date.now()}`;
    const startedAt = Date.now();
    set({
      chat: [...get().chat, userMsg, { id: aiId, role: "assistant", content: "", question, nodeId: key }],
      chatBusy: true,
      chatSessionId: sessionId,
      nodeSessionIds: { ...get().nodeSessionIds, [key]: sessionId },
    });
    try {
      await vault.appendChat(nb.id, {
        id: userMsg.id,
        role: "user",
        content: userMsg.content,
        createdAt: new Date(startedAt).toISOString(),
        sessionId,
        nodeId: key,
      });
      const modelId = get().chatModelId ?? nb.defaultModelId;
      const d = deps(get().settings, modelId);
      const scopeData: ChatScope = await buildChatScope(vault, nb, nodeId, scope);
      // 面板上的地球开关控制这条消息是否先联网检索；搜索失败返回空数组，不影响回答
      const webPages = get().settings.webSearch ? await searchWeb(question, 4) : [];
      const pathText = nodeId ? nb.nodes.find((n) => n.id === nodeId)?.title ?? nb.title : nb.title;
      // 把真正读到的页面记到这条消息上，供界面显示「参考了 N 页」
      const pages = scopeData.pages.map((p) => p.title.split(" › ").pop() ?? p.title);
      const pageIds = scopeData.pages.map((p) => p.id);
      set({ chat: get().chat.map((m) => (m.id === aiId ? { ...m, pages, pageIds } : m)) });
      let text = "";
      for await (const ev of streamChat(d, {
        nb,
        scope: scopeData,
        question,
        currentPath: pathText,
        selectedText,
        uploads,
        webPages,
      })) {
        if (ev.type === "delta") {
          text += ev.text;
          set({ chat: get().chat.map((m) => (m.id === aiId ? { ...m, content: text } : m)) });
        }
      }
      if (!text.trim()) throw new Error(pick(get().settings.language, "模型没有返回内容", "The model returned no content."));
      const entry: ChatEntry = {
        id: aiId,
        role: "assistant",
        content: text,
        createdAt: new Date().toISOString(),
        sessionId,
        question,
        nodeId: key,
      };
      await vault.appendChat(nb.id, entry).catch(() => {
        // 归档失败不影响这次回答展示
      });
    } catch (err) {
      set({
        chat: get().chat.map((m) =>
          m.id === aiId
            ? { ...m, content: err instanceof Error ? err.message : String(err), error: true }
            : m,
        ),
      });
    } finally {
      set({
        chat: get().chat.map((m) => (m.id === aiId ? { ...m, ms: Date.now() - startedAt } : m)),
        chatBusy: false,
        selection: null,
      });
    }
  },
}));

/* ---------------------------------------------------------------- 导出辅助 */

interface ExportSection {
  title: string;
  level: number;
  body: string;
  highlights?: Highlight[];
}

interface ExportView {
  root: Node | null;
  nodes: Node[];
  sections: ExportSection[];
  bodies: Record<string, string>;
}

/** 节点自身 + 全部子孙 id */
function subtreeIds(nb: Notebook, id: string): Set<string> {
  const out = new Set<string>([id]);
  const walk = (pid: string) => {
    for (const n of nb.nodes) {
      if (n.parentId === pid && !out.has(n.id)) {
        out.add(n.id);
        walk(n.id);
      }
    }
  };
  walk(id);
  return out;
}

/** 组件页存的是 JSON，导出时转成能读的 Markdown；不是组件就返回 null */
function componentToMarkdown(kind: Node["pageKind"], raw: string, lang: Lang = "zh"): string | null {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  const items = Array.isArray(data.items) ? (data.items as Array<Record<string, unknown>>) : [];
  if (!items.length) return null;
  if (kind === "flashcards") {
    return items
      .map((it, i) => `**${pick(lang, `卡片 ${i + 1}：`, `Card ${i + 1}: `)}${String(it.front ?? "")}**\n\n${String(it.back ?? "")}`)
      .join("\n\n");
  }
  if (kind === "glossary") {
    return [pick(lang, "| 术语 | 英文 | 释义 |", "| Term | English | Definition |"), "| --- | --- | --- |"]
      .concat(items.map((it) => `| ${String(it.term ?? "")} | ${String(it.en ?? "")} | ${String(it.definition ?? "")} |`))
      .join("\n");
  }
  return null;
}

/** 读一份可直接导出的正文：组件转成 Markdown */
async function exportBody(vault: Vault, nbId: string, node: Node, lang: Lang): Promise<string> {
  const raw = await vault.getNodeBody(nbId, node.id);
  if (!raw) return "";
  return componentToMarkdown(node.pageKind, raw, lang) ?? raw;
}

/**
 * 导出视图：scope=book 导整本；scope=chapter 只导该章子树。
 * 整本导出时每章都从新页开始，单章导出时章是顶层、节降一级。
 */
async function buildExportView(
  vault: Vault,
  nb: Notebook,
  scope: "book" | "chapter",
  chapterId: string | undefined,
  lang: Lang,
): Promise<ExportView> {
  const rootNode = nb.nodes.find((n) => n.kind === "root") ?? null;
  const picked = scope === "chapter" && chapterId ? nb.nodes.find((n) => n.id === chapterId) : undefined;
  const scopeRoot = picked ?? rootNode;
  const ids = scopeRoot ? subtreeIds(nb, scopeRoot.id) : new Set(nb.nodes.map((n) => n.id));
  const nodes = nb.nodes.filter((n) => ids.has(n.id));
  const bodies: Record<string, string> = {};
  const sections: ExportSection[] = [];
  const childrenOf = (pid: string) =>
    nb.nodes.filter((n) => n.parentId === pid && ids.has(n.id)).sort((a, b) => a.order - b.order);
  const walk = async (node: Node, level: number) => {
    const body = await exportBody(vault, nb.id, node, lang);
    bodies[node.id] = body;
    sections.push({ title: node.title, level, body, highlights: node.highlights ?? [] });
    for (const child of childrenOf(node.id)) {
      if (child.kind !== "page") {
        await walk(child, node.kind === "root" ? 1 : Math.min(3, level + 1));
        continue;
      }
      const pb = await exportBody(vault, nb.id, child, lang);
      bodies[child.id] = pb;
      sections.push({
        title: `${pick(lang, "附：", "Appendix: ")}${child.title}`,
        level: Math.min(3, level + 1),
        body: pb,
        highlights: child.highlights ?? [],
      });
    }
  };
  if (scopeRoot) await walk(scopeRoot, 1);
  return { root: scopeRoot, nodes, sections, bodies };
}

/** 按扩展名猜 MIME，用于把附件图片发给支持视觉的模型 */
function mimeOf(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
    bmp: "image/bmp",
    heic: "image/heic",
    svg: "image/svg+xml",
    pdf: "application/pdf",
    txt: "text/plain",
    md: "text/markdown",
    json: "application/json",
  };
  return map[ext] ?? "application/octet-stream";
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  return buf;
}

function newSessionId(): string {
  return `s${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
}

/** 从回答里取一个适合做页名的短标题：优先一级标题，其次首句 */
function noteTitle(content: string, lang: Lang): string {
  const lines = content.split("\n").map((l) => l.trim()).filter(Boolean);
  const heading = lines.find((l) => /^#{1,6}\s+/.test(l));
  const base = (heading ?? lines[0] ?? pick(lang, "AI 笔记", "AI note"))
    .replace(/^#{1,6}\s+/, "")
    .replace(/\*\*/g, "")
    .replace(/[。！？；，、].*$/, "")
    .trim();
  return base.slice(0, 28) || pick(lang, "AI 笔记", "AI note");
}

/** 章/节在结构里的完整路径，供组件提示词的 path 变量使用 */
function nodePathOf(nb: Notebook, nodeId: string): string {
  const byId = new Map(nb.nodes.map((n) => [n.id, n]));
  const parts: string[] = [];
  let cur = byId.get(nodeId);
  while (cur) {
    parts.unshift(cur.title);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return parts.join(" › ");
}

/** 当前激活标签对应的节点 id（供对话上下文使用） */
export function activeNodeId(state: Pick<AppStore, "tabs" | "activeTabId">): string | null {
  const tab = state.tabs.find((t) => t.id === state.activeTabId);
  return tab?.nodeId ?? null;
}

/** 对话归属的节点：思维导图等无节点的界面统一挂在根节点下 */
export function chatNodeKey(
  state: Pick<AppStore, "tabs" | "activeTabId" | "nb">,
): string {
  return activeNodeId(state) ?? state.nb?.nodes.find((n) => n.kind === "root")?.id ?? "root";
}

export function styleName(id: string): string {
  if (id.startsWith("custom:")) return id.slice(7) || "自定义";
  return STYLE_PRESETS.find((s) => s.id === id)?.name ?? id;
}
