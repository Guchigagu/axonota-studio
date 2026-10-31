import { useEffect, useMemo, useRef, useState } from "react";
import type { Node, Notebook } from "@nb/core";
import { activeNodeId, chatNodeKey, useApp, type ChatMessageView, type ChatUpload, type ComponentKind } from "../store";
import { useT } from "../i18n";
import { Markdown } from "./Markdown";
import { ModelMenu } from "./ModelMenu";

/** 与 buildChatScope 相同的取舍，只算「会读哪些页」，不读正文 */
function scopePages(nb: Notebook, nodeId: string | null, mode: "chapter" | "book" | "auto"): Node[] {
  const done = nb.nodes.filter((n) => n.status === "done" && n.kind !== "root" && n.kind !== "page");
  if (mode === "book") return done;
  const byId = new Map(nb.nodes.map((n) => [n.id, n]));
  let cur = nodeId ? byId.get(nodeId) : undefined;
  if (cur?.kind === "root") cur = undefined;
  let chapter: Node | undefined;
  let p = cur;
  while (p) {
    if (p.kind === "chapter") {
      chapter = p;
      break;
    }
    p = p.parentId ? byId.get(p.parentId) : undefined;
  }
  if (!chapter) return done;
  const ids = new Set<string>([chapter.id, ...nb.nodes.filter((n) => n.parentId === chapter.id).map((n) => n.id)]);
  return done.filter((n) => ids.has(n.id) || ids.has(n.parentId ?? ""));
}

const SCOPE_LABEL = {
  chapter: { zh: "本章", en: "This chapter" },
  book: { zh: "全本", en: "Whole book" },
  auto: { zh: "自动", en: "Auto" },
} as const;

const ASK_ACTIONS = [
  {
    zhLabel: "解释",
    enLabel: "Explain",
    zhPrompt: "把这一节的核心概念用通俗的话解释清楚，最后给一句总结。",
    enPrompt: "Explain the core concepts of this section in plain language, and end with a one-sentence summary.",
  },
  {
    zhLabel: "形象化理解",
    enLabel: "Intuition",
    zhPrompt: "把这一节的核心概念用形象的类比讲清楚，并说明这个类比的边界在哪里。",
    enPrompt: "Use vivid analogies to explain the core concepts of this section, and point out where each analogy breaks down.",
  },
  {
    zhLabel: "联系现实",
    enLabel: "Real world",
    zhPrompt: "把这一节的内容联系到现实生活和实际应用场景，给出具体例子说明它在哪里用得上。",
    enPrompt: "Connect this section to real life and practical scenarios, with concrete examples of where it applies.",
  },
  {
    zhLabel: "例题",
    enLabel: "Practice",
    zhPrompt: "根据这一节内容出两道有梯度的例题，并给出解题过程。",
    enPrompt: "Create two practice questions of increasing difficulty based on this section, with worked solutions.",
  },
];

const GEN_ACTIONS: Array<{ zhLabel: string; enLabel: string; kind: ComponentKind }> = [
  { zhLabel: "闪卡", enLabel: "Flashcards", kind: "flashcards" },
  { zhLabel: "速查", enLabel: "Glossary", kind: "glossary" },
];

const AI_ICON = ({ size = 13 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path
      d="M4.6 4.4h10.8a2.6 2.6 0 0 1 2.6 2.6v6a2.6 2.6 0 0 1-2.6 2.6H9.6L5.4 19v-3.4H4.6a2.6 2.6 0 0 1-2.6-2.6V7a2.6 2.6 0 0 1 2.6-2.6z"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
    />
    <circle cx="10" cy="10" r="1.9" fill="currentColor" />
  </svg>
);

export function ChatPanel() {
  const t = useT();
  const nb = useApp((s) => s.nb);
  const tabs = useApp((s) => s.tabs);
  const activeTabId = useApp((s) => s.activeTabId);
  const chat = useApp((s) => s.chat);
  const chatBusy = useApp((s) => s.chatBusy);
  const chatScope = useApp((s) => s.chatScope);
  const chatModelId = useApp((s) => s.chatModelId);
  const setChatScope = useApp((s) => s.setChatScope);
  const setChatModel = useApp((s) => s.setChatModel);
  const sendChat = useApp((s) => s.sendChat);
  const clearChat = useApp((s) => s.clearChat);
  const setChatOpen = useApp((s) => s.setChatOpen);
  const selection = useApp((s) => s.selection);
  const setSelection = useApp((s) => s.setSelection);
  const settings = useApp((s) => s.settings);
  const toggleWebSearch = useApp((s) => s.toggleWebSearch);
  const generatePage = useApp((s) => s.generatePage);
  const generateCustomPage = useApp((s) => s.generateCustomPage);
  const restructureNode = useApp((s) => s.restructureNode);
  const addAttachments = useApp((s) => s.addAttachments);
  const ensureBody = useApp((s) => s.ensureBody);
  const saveBody = useApp((s) => s.saveBody);
  const openSettings = useApp((s) => s.openSettings);
  const openNode = useApp((s) => s.openNode);
  const chatSessions = useApp((s) => s.chatSessions);
  const refreshChatSessions = useApp((s) => s.refreshChatSessions);
  const openChatSession = useApp((s) => s.openChatSession);
  const saveChatAsNote = useApp((s) => s.saveChatAsNote);
  const [input, setInput] = useState("");
  const [files, setFiles] = useState<ChatUpload[]>([]);
  const [composeMode, setComposeMode] = useState<"chat" | "custom" | "structure">("chat");
  const [scopeWhole, setScopeWhole] = useState(true);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [refsOpen, setRefsOpen] = useState<Record<string, boolean>>({});
  const [historyOpen, setHistoryOpen] = useState(false);
  const [ctxChipHidden, setCtxChipHidden] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const nodeId = activeNodeId({ tabs, activeTabId });
  // 每个节点的对话互相独立：只展示属于当前节点的消息与会话
  const chatKey = chatNodeKey({ nb, tabs, activeTabId });
  const visibleChat = useMemo(
    () => chat.filter((m) => (m.nodeId ?? "root") === chatKey),
    [chat, chatKey],
  );
  const nodeSessions = useMemo(
    () => chatSessions.filter((s) => (s.nodeId ?? "root") === chatKey),
    [chatSessions, chatKey],
  );
  const currentNode = nb?.nodes.find((n) => n.id === nodeId);
  const canInsert = !!nodeId && currentNode?.kind !== "page";
  // 快捷动作的落点：当前节/章；当前是组件页时退回它的父节点；在思维导图页时退回全书根节点
  const targetNode = useMemo(() => {
    if (!nb) return undefined;
    if (currentNode && currentNode.kind !== "page") return currentNode;
    if (currentNode?.parentId) return nb.nodes.find((n) => n.id === currentNode.parentId);
    return nb.nodes.find((n) => n.kind === "root");
  }, [nb, currentNode]);
  const pages = useMemo(
    () => (nb ? scopePages(nb, nodeId, chatScope) : []),
    [nb, nodeId, chatScope],
  );
  // 与 buildChatScope 的附件取舍一致：根文件 + 本节附件 + 祖先「继承到下级」
  const scopedFiles = useMemo(() => {
    if (!nb) return [];
    const byId = new Map(nb.nodes.map((n) => [n.id, n]));
    const chain: Node[] = [];
    let cur: Node | undefined = nodeId ? byId.get(nodeId) : undefined;
    while (cur) {
      chain.unshift(cur);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    const out = new Map<string, string>();
    for (const a of nb.nodes.find((n) => n.kind === "root")?.attachments ?? []) out.set(a.path, a.name);
    for (const a of (nodeId ? byId.get(nodeId)?.attachments : undefined) ?? []) out.set(a.path, a.name);
    for (const n of chain.slice(0, -1)) {
      if (n.kind === "root") continue;
      for (const a of n.attachments ?? []) if (a.inherit) out.set(a.path, a.name);
    }
    return [...out.values()];
  }, [nb, nodeId]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [chat, chatBusy]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 1500);
    return () => clearTimeout(t);
  }, [flash]);

  if (!nb) return null;

  const modelId = chatModelId ?? nb.defaultModelId ?? settings.models[0]?.id ?? "";
  const modelValue = settings.models.some((m) => m.id === modelId) ? modelId : settings.models[0]?.id ?? "";
  const rounds = visibleChat.filter((m) => m.role === "user").length;
  const currentTitle = currentNode?.title ?? nb.title;

  async function pickFiles(list: FileList | null) {
    const picked = Array.from(list ?? []);
    if (!picked.length) return;
    // 图片直接存进当前节点附件（可被视觉模型读到）；文本随本条消息发送
    const attachTargetId = currentNode?.kind === "page" ? currentNode.parentId : nodeId;
    const loaded: ChatUpload[] = [];
    for (const f of picked) {
      if (f.type.startsWith("image/")) {
        if (attachTargetId) {
          await addAttachments(attachTargetId, [f]);
          setFlash(`img:${f.name}`);
        }
        continue;
      }
      try {
        loaded.push({ name: f.name, text: (await f.text()).slice(0, 12000) });
      } catch {
        // 读不了的文件（权限或损坏）直接跳过
      }
    }
    setFiles((prev) => [...prev, ...loaded].slice(0, 5));
  }

  async function send() {
    const q = input.trim();
    if (!q || chatBusy) return;
    if (composeMode === "custom") {
      setInput("");
      setComposeMode("chat");
      await generateCustomPage(q);
      return;
    }
    if (composeMode === "structure") {
      setInput("");
      setComposeMode("chat");
      await restructureNode(scopeWhole ? null : targetNode?.id ?? null, q);
      return;
    }
    const uploads = files;
    setInput("");
    setFiles([]);
    await sendChat(q, uploads);
  }

  // 快捷动作只把提示词填进输入框，用户可以改完再自己发
  function fill(prompt: string) {
    setComposeMode("chat");
    setInput(prompt);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  async function copy(m: ChatMessageView) {
    try {
      await navigator.clipboard.writeText(m.content);
      setFlash(`${m.id}:copy`);
    } catch {
      // 剪贴板不可用时保持静默，不假装复制成功
    }
  }

  async function insert(bodyNodeId: string, text: string) {
    await ensureBody(bodyNodeId);
    const cur = useApp.getState().bodies[bodyNodeId] ?? "";
    await saveBody(bodyNodeId, cur ? `${cur.trimEnd()}\n\n${text}` : text);
    setFlash(`${bodyNodeId}:inserted`);
  }

  return (
    <aside className="relative flex h-full w-[344px] flex-none flex-col border-l border-border bg-bg">
      {/* 01 头部：会话级操作 */}
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="ax-avatar">
            <AI_ICON />
          </span>
          <span className="text-[13px] font-medium">{t("AI 助手", "AI Assistant")}</span>
          <span className="truncate text-[11px] text-mutedfg">
            {rounds > 0
              ? t(`本次 ${rounds} 轮`, `${rounds} turn${rounds === 1 ? "" : "s"}`)
              : t("新会话", "New chat")}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            className="ax-icon-btn h-7 w-7"
            title={t("历史会话", "History")}
            onClick={() => {
              setHistoryOpen((v) => !v);
              if (!historyOpen) void refreshChatSessions();
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="8.5" />
              <path d="M12 7.5V12l3 2" />
            </svg>
          </button>
          <button
            className="ax-icon-btn h-7 w-7"
            title={t("新对话：清空当前对话面板，已归档记录不受影响", "New chat: clears this panel; archived chats are kept")}
            disabled={!visibleChat.length || chatBusy}
            onClick={clearChat}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
          <button className="ax-icon-btn h-7 w-7" title={t("收起侧栏", "Collapse sidebar")} onClick={() => setChatOpen(false)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="M15 4v16" />
            </svg>
          </button>
        </div>
      </div>

      {historyOpen && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setHistoryOpen(false)} />
          <div className="ax-panel-float absolute right-2 top-12 z-40 w-[248px] p-1.5">
            <div className="px-2 py-1 text-[10px] text-ink3">{t("历史会话（当前节点）", "History (this node)")}</div>
            {nodeSessions.length === 0 ? (
              <div className="px-2 py-3 text-[11px] text-ink3">
                {t("这个节点还没有归档的对话。", "No archived chats for this node yet.")}
              </div>
            ) : (
              <div className="ax-scroll max-h-[320px] overflow-y-auto">
                {nodeSessions.map((s) => (
                  <button
                    key={s.id}
                    className="block w-full rounded-[6px] px-2 py-1.5 text-left hover:bg-muted"
                    onClick={() => {
                      void openChatSession(s.id);
                      setHistoryOpen(false);
                    }}
                  >
                    <div className="truncate text-[12px]">{s.title}</div>
                    <div className="mt-0.5 text-[10px] text-ink3">
                      {t(`${s.rounds} 轮`, `${s.rounds} turn${s.rounds === 1 ? "" : "s"}`)} ·{" "}
                      {new Date(s.at).toLocaleString(t("zh-CN", "en-US"), {
                        month: "numeric",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* 03 主体：上下文 + 对话 */}
      <div ref={listRef} className="ax-scroll min-h-0 flex-1 overflow-y-auto">
        {/* 上下文卡：AI 当前读到的 */}
        <div className="border-b border-border px-3 py-2.5">
          <div className="flex items-center justify-between">
            <span className="ax-eyebrow">{t("AI 当前读到的", "What AI is reading")}</span>
            <button
              className="text-[11px] text-mutedfg hover:text-fg"
              onClick={() => setSourcesOpen((v) => !v)}
            >
              {sourcesOpen ? t("收起来源", "Hide sources") : t("展开来源", "Show sources")}
            </button>
          </div>
          <div className="ax-panel-flat mt-2 px-2.5 py-2">
            <div className="flex items-center gap-1.5">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-mutedfg">
                <path d="M4 6.5A3.5 3.5 0 0 1 7.5 3H20v18H7.5A3.5 3.5 0 0 1 4 17.5z" />
                <path d="M9 8h7M9 12h5" />
              </svg>
              <span className="truncate text-[12px] font-medium">{currentTitle}</span>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              <span className="ax-badge h-[18px] text-[10px]">{t("正文", "Body")}</span>
              {selection && (
                <span className="ax-badge ax-badge-user inline-flex h-[18px] items-center gap-1 text-[10px]">
                  {t(`已选中 ${selection.length} 字`, `${selection.length} chars selected`)}
                  <button
                    className="grid h-3.5 w-3.5 cursor-pointer place-items-center rounded-full leading-none text-ink3 hover:bg-surface2 hover:text-fg"
                    title={t("移除选中的文字", "Remove selected text")}
                    aria-label={t("移除选中的文字", "Remove selected text")}
                    onClick={() => setSelection(null)}
                  >
                    ×
                  </button>
                </span>
              )}
              <span className="text-[10px] text-ink3">
                {t(SCOPE_LABEL[chatScope].zh, SCOPE_LABEL[chatScope].en)} ·{" "}
                {t(`将读 ${pages.length} 页`, `reads ${pages.length} page${pages.length === 1 ? "" : "s"}`)}
                {scopedFiles.length > 0
                  ? ` · ${t(`${scopedFiles.length} 个附件`, `${scopedFiles.length} attachment${scopedFiles.length === 1 ? "" : "s"}`)}`
                  : ""}
              </span>
            </div>
          </div>
          {sourcesOpen && (
            <div className="mt-1.5">
              {pages.length === 0 ? (
                <p className="text-[11px] text-ink3">
                  {t(
                    "还没有已生成的页面可读，回答会只依据当前问题和上下文。",
                    "No generated pages to read yet; answers will rely only on your question and context.",
                  )}
                </p>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {pages.map((p) => (
                    <span key={p.id} className="ax-tag-page max-w-[150px] truncate" title={p.title}>
                      {p.title}
                    </span>
                  ))}
                </div>
              )}
              {scopedFiles.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {scopedFiles.map((name) => (
                    <span key={name} className="ax-badge h-[18px] max-w-[150px] truncate text-[10px]" title={name}>
                      {name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 对话 */}
        {visibleChat.length === 0 && (
          <div className="px-3 pt-3">
            <div className="rounded-lg border border-dashed border-border px-3 py-3 text-[11px] leading-relaxed text-ink3">
              {t(
                "就当前这一节提问，或点下面的快捷动作。回答下方会列出这次实际读到的页面。",
                "Ask about this section, or use a quick action below. Sources actually read are listed under each answer.",
              )}
            </div>
          </div>
        )}

        {visibleChat.map((m) => {
          if (m.role === "user") {
            return (
              <div key={m.id} className="px-3 pt-3">
                <div className="flex justify-end">
                  <div className="ax-bubble-user max-w-[88%] whitespace-pre-wrap break-words">{m.content}</div>
                </div>
              </div>
            );
          }
          if (!m.content && !m.error) return null;
          return (
            <div key={m.id} className="mt-4 px-3">
              <div className="mb-1.5 flex items-center gap-1.5">
                <span className="ax-avatar h-[18px] w-[18px]">
                  <AI_ICON size={12} />
                </span>
                <span className="text-[10px] text-mutedfg">
                  {t("AI 助手", "AI Assistant")}
                  {m.ms ? ` · ${(m.ms / 1000).toFixed(1)} s` : ""}
                  {m.pages?.length
                    ? ` · ${t(`读了 ${m.pages.length} 项依据`, `read ${m.pages.length} source${m.pages.length === 1 ? "" : "s"}`)}`
                    : ""}
                </span>
              </div>
              {m.error ? (
                <div className="text-[12px] leading-relaxed text-[var(--ax-err)]">{m.content}</div>
              ) : (
                <div className="ax-bubble-ai">
                  <Markdown text={m.content} />
                </div>
              )}
              {!m.error && !!m.pages?.length && (
                <div className="mt-2">
                  <button
                    className="flex items-center gap-1 text-[11px] text-mutedfg hover:text-fg"
                    onClick={() => setRefsOpen((v) => ({ ...v, [m.id]: !v[m.id] }))}
                  >
                    <span className="text-[10px] text-ink3">{refsOpen[m.id] ? "▾" : "▸"}</span>
                    {t(`参考了 ${m.pages.length} 页`, `Referenced ${m.pages.length} page${m.pages.length === 1 ? "" : "s"}`)}
                  </button>
                  {refsOpen[m.id] && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {m.pages.map((p, i) => {
                        const pid = m.pageIds?.[i];
                        return pid ? (
                          <button
                            key={`${m.id}-p${i}`}
                            className="ax-tag-page max-w-[150px] truncate hover:text-fg hover:underline"
                            title={t(`打开：${p}`, `Open: ${p}`)}
                            onClick={() => void openNode(pid)}
                          >
                            {p}
                          </button>
                        ) : (
                          <span key={`${m.id}-p${i}`} className="ax-tag-page max-w-[150px] truncate" title={p}>
                            {p}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
              {!m.error && !chatBusy && (
                <div className="mt-2 flex items-center gap-3 text-[11px] text-mutedfg">
                  <button className="hover:text-fg" onClick={() => void copy(m)}>
                    {flash === `${m.id}:copy` ? t("已复制", "Copied") : t("复制", "Copy")}
                  </button>
                  {canInsert && nodeId && (
                    <button className="hover:text-fg" onClick={() => void insert(nodeId, m.content)}>
                      {flash === `${nodeId}:inserted` ? t("已插入", "Inserted") : t("插入正文", "Insert")}
                    </button>
                  )}
                  {m.content && (
                    <button
                      className="hover:text-fg"
                      onClick={() => {
                        void saveChatAsNote(m.content);
                        setFlash(`${m.id}:note`);
                      }}
                    >
                      {flash === `${m.id}:note` ? t("已存入文件栏", "Saved to Files") : t("存为笔记", "Save as note")}
                    </button>
                  )}
                  {m.question && (
                    <button className="hover:text-fg" onClick={() => void sendChat(m.question!)}>
                      {t("重新生成", "Regenerate")}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {chatBusy && (
          <div className="px-3 py-2.5">
            <div className="flex items-center gap-1.5">
              <span className="ax-badge ax-badge-run h-[18px] text-[10px]">
                <span className="ax-spinner" />
                {t("生成中", "Generating")}
              </span>
              <span className="text-[10px] text-mutedfg">
                {t("正在读资料、写回答…", "Reading sources and writing…")}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* 04 快捷动作：按意图分组 */}
      <div className="shrink-0 border-t border-border px-3 pb-1.5 pt-2">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="ax-eyebrow">{t("快捷动作", "Quick actions")}</span>
          <span className="truncate text-[10px] text-mutedfg">
            {selection
              ? t(`作用于「已选中的 ${selection.length} 字」`, `Applies to ${selection.length} selected chars`)
              : t(`作用于「${targetNode?.title ?? currentTitle}」`, `Applies to "${targetNode?.title ?? currentTitle}"`)}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-[26px] shrink-0 text-[10px] text-mutedfg">{t("生成", "Create")}</span>
          {GEN_ACTIONS.map((a) => (
            <button
              key={a.kind}
              className="flex h-[24px] flex-1 items-center justify-center rounded-[6px] border border-border text-[11px] hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!targetNode || chatBusy}
              title={
                targetNode
                  ? t(`在「${targetNode.title}」下生成${a.zhLabel}`, `Create ${a.enLabel} under "${targetNode.title}"`)
                  : t("还没有可作用的位置", "Nothing to apply to yet")
              }
              onClick={() => void generatePage(targetNode!.id, a.kind)}
            >
              {t(a.zhLabel, a.enLabel)}
            </button>
          ))}
          <button
            className="flex h-[24px] flex-1 items-center justify-center rounded-[6px] border border-border text-[11px] hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
            disabled={chatBusy}
            onClick={() => fill(t("用三句话小结这一节，给出最关键的结论。", "Summarize this section in three sentences with the key takeaway."))}
          >
            {t("小结", "Summary")}
          </button>
        </div>
        <div className="mt-1.5 flex items-center gap-1">
          <span className="w-[26px] shrink-0 text-[10px] text-mutedfg">{t("理解", "Understand")}</span>
          {ASK_ACTIONS.map((a) => (
            <button
              key={a.zhLabel}
              className="flex h-[24px] flex-1 items-center justify-center rounded-[6px] border border-border text-[11px] hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
              disabled={chatBusy}
              onClick={() => fill(t(a.zhPrompt, a.enPrompt))}
            >
              {t(a.zhLabel, a.enLabel)}
            </button>
          ))}
        </div>
        <div className="mt-1.5 flex items-center gap-1">
          <span className="w-[26px] shrink-0 text-[10px] text-mutedfg">{t("更多", "More")}</span>
          <button
            className={`flex h-[24px] flex-1 items-center justify-center rounded-[6px] border text-[11px] disabled:cursor-not-allowed disabled:opacity-40 ${
              composeMode === "custom" ? "border-accent bg-accent-soft text-fg" : "border-border hover:bg-muted"
            }`}
            disabled={chatBusy}
            title={t("在输入框里描述你想要的页面，AI 会生成一张活页纸", "Describe the page you want; AI will generate a new page")}
            onClick={() => setComposeMode((m) => (m === "custom" ? "chat" : "custom"))}
          >
            {t("自定义页", "Custom page")}
          </button>
          <button
            className={`flex h-[24px] flex-1 items-center justify-center rounded-[6px] border text-[11px] disabled:cursor-not-allowed disabled:opacity-40 ${
              composeMode === "structure" ? "border-accent bg-accent-soft text-fg" : "border-border hover:bg-muted"
            }`}
            disabled={chatBusy}
            title={t("描述怎么改结构，AI 只调整结构，已写正文的节点不动", "Describe the restructure; only structure changes, nodes with body text stay put")}
            onClick={() => setComposeMode((m) => (m === "structure" ? "chat" : "structure"))}
          >
            {t("调结构", "Restructure")}
          </button>
        </div>
      </div>
      <div className="shrink-0 px-3 pb-2.5">
        <div className="ax-composer px-2.5 py-2">
          <div className="mb-1.5 flex flex-wrap items-center gap-1">
            {selection && (
              <span className="flex h-[20px] shrink-0 items-center gap-1 rounded-[4px] bg-surface2 pl-1.5 pr-1 text-[10px] text-mutedfg">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <path d="M20 12l-8 8-9-9V4h7z" />
                </svg>
                <span className="max-w-[92px] truncate">{t(`选中 ${selection.length} 字`, `Selected ${selection.length} chars`)}</span>
                <button
                  type="button"
                  className="ml-0.5 grid h-3.5 w-3.5 cursor-pointer place-items-center rounded-full leading-none text-ink3 hover:bg-surface2 hover:text-fg"
                  title={t("取消引用", "Remove selection")}
                  aria-label={t("取消引用", "Remove selection")}
                  onClick={() => setSelection(null)}
                >
                  ×
                </button>
              </span>
            )}
            {nodeId && !ctxChipHidden && (
              <span className="flex h-[20px] shrink-0 items-center gap-1 rounded-[4px] bg-surface2 pl-1.5 pr-1 text-[10px] text-mutedfg">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 6.5A3.5 3.5 0 0 1 7.5 3H20v18H7.5A3.5 3.5 0 0 1 4 17.5z" />
                </svg>
                <span className="max-w-[92px] truncate">{t(`${currentTitle} 正文`, `${currentTitle} · Body`)}</span>
                <button
                  type="button"
                  className="ml-0.5 grid h-3.5 w-3.5 cursor-pointer place-items-center rounded-full leading-none text-ink3 hover:bg-surface2 hover:text-fg"
                  title={t("移除本节上下文标记", "Remove this context tag")}
                  aria-label={t("移除本节上下文标记", "Remove this context tag")}
                  onClick={() => setCtxChipHidden(true)}
                >
                  ×
                </button>
              </span>
            )}
            {files.map((f, i) => (
              <span
                key={`${f.name}-${i}`}
                className="flex h-[20px] shrink-0 items-center gap-1 rounded-[4px] bg-surface2 pl-1.5 pr-1 text-[10px] text-mutedfg"
              >
                <span className="max-w-[92px] truncate">{f.name}</span>
                <button
                  className="ml-0.5 hover:text-fg"
                  title={t("移除附件", "Remove attachment")}
                  onClick={() => setFiles(files.filter((_, j) => j !== i))}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          {composeMode !== "chat" && (
            <div className="mb-1 flex flex-wrap items-center gap-1.5 rounded-[6px] bg-surface2 px-2 py-1 text-[10.5px] text-mutedfg">
              <span className="font-medium text-fg">
                {composeMode === "custom" ? t("自定义页", "Custom page") : t("调整结构", "Restructure")}
              </span>
              <span>
                {composeMode === "custom"
                  ? t("描述想要的页面，回车生成一张活页纸", "Describe the page; press Enter to generate it")
                  : t("描述怎么改，只动结构、已写正文的节点保留", "Describe the change; only structure moves, nodes with body text stay")}
              </span>
              {composeMode === "structure" && (
                <span className="ml-auto flex items-center gap-1">
                  <button
                    className={`ax-chip h-5 px-1.5 text-[10px] ${scopeWhole ? "ax-chip-active" : ""}`}
                    onClick={() => setScopeWhole(true)}
                  >
                    {t("整本", "Whole book")}
                  </button>
                  <button
                    className={`ax-chip h-5 px-1.5 text-[10px] ${scopeWhole ? "" : "ax-chip-active"}`}
                    onClick={() => setScopeWhole(false)}
                    disabled={!targetNode || targetNode.kind === "root"}
                  >
                    {t("当前章", "This chapter")}
                  </button>
                </span>
              )}
              <button className="text-ink3 hover:text-fg" title={t("退出", "Exit")} onClick={() => setComposeMode("chat")}>
                ×
              </button>
            </div>
          )}
          <textarea
            ref={inputRef}
            rows={2}
            className="ax-textarea"
            placeholder={
              composeMode === "custom"
                ? t("例如：做一页「三种排序算法」对比表，含复杂度与适用场景…", "e.g. A comparison table of three sorting algorithms, with complexity and use cases…")
                : composeMode === "structure"
                  ? t("例如：把第三章拆成两章；把「进阶」挪到第二章末尾…", "e.g. Split chapter 3 into two; move \"Advanced\" to the end of chapter 2…")
                  : t("就这一节继续问，或让 AI 生成一个组件…", "Ask about this section, or have AI create a component…")
            }
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <div className="mt-1 flex items-center justify-between">
            <div className="flex items-center gap-0.5">
              <div className="mr-1 flex shrink-0 items-center gap-0.5 rounded-[6px] bg-surface2 p-0.5">
                {(["chapter", "book", "auto"] as const).map((s) => (
                  <button
                    key={s}
                    className={`flex h-[22px] items-center justify-center rounded-[4px] px-1.5 text-[10px] ${
                      chatScope === s ? "bg-card text-fg shadow-sm" : "text-mutedfg hover:text-fg"
                    }`}
                    title={
                      s === "chapter"
                        ? t("本章：只读当前这一章，最聚焦", "This chapter: only the current chapter, most focused")
                        : s === "book"
                          ? t("全本：把整本笔记本作为依据", "Whole book: use the entire notebook as context")
                          : t("自动：按问题判断读本节、本章还是全本", "Auto: choose section, chapter, or whole book based on the question")
                    }
                    onClick={() => void setChatScope(s)}
                  >
                    {t(SCOPE_LABEL[s].zh, SCOPE_LABEL[s].en)}
                  </button>
                ))}
              </div>
              <button
                className="ax-icon-btn h-7 w-7"
                title={t(
                  "上传附件：文本随消息发送，图片直接存进当前节点的附件",
                  "Attachments: text is sent with the message; images are saved to this node's attachments",
                )}
                onClick={() => fileRef.current?.click()}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
                  <path d="M8.5 7.5V16a3.5 3.5 0 0 0 7 0V7a2 2 0 0 0-4 0v8.5" />
                </svg>
              </button>
              <input
                ref={fileRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  void pickFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              <button
                className={`ax-icon-btn h-7 w-7 ${settings.webSearch ? "is-on" : ""}`}
                title={
                  settings.webSearch
                    ? t("联网已开启，点一下关闭", "Web search is on. Click to turn off.")
                    : t("联网已关闭，点一下开启", "Web search is off. Click to turn on.")
                }
                aria-pressed={settings.webSearch}
                onClick={() => void toggleWebSearch()}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
                </svg>
              </button>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <ModelMenu
                models={settings.models}
                value={modelValue}
                onSelect={(id) => setChatModel(id)}
                onManage={openSettings}
                align="right"
                title={t("这条对话使用哪个模型（就地切换）", "Model for this chat (switch in place)")}
              />
              <button
                className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-fg text-bg disabled:cursor-not-allowed disabled:opacity-40"
                title={t("发送（Enter）", "Send (Enter)")}
                disabled={!input.trim() || chatBusy}
                onClick={() => void send()}
              >
                {chatBusy ? (
                  <span className="ax-spinner border-bg" />
                ) : (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
                    <path d="M12 19V6M6 12l6-6 6 6" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>
        <div className="mt-1.5 flex items-center px-0.5">
          <span className="text-[10px] text-mutedfg">{t("Enter 发送 · Shift+Enter 换行", "Enter to send · Shift+Enter for a newline")}</span>
        </div>
      </div>
    </aside>
  );
}
