import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Node, Notebook } from "@nb/core";
import { useApp, type ComponentKind } from "../store";
import { openExternal } from "../lib/env";
import { useT, pick } from "../i18n";
import { Markdown } from "./Markdown";
import { CodeEditor } from "./CodeEditor";
import { PageView } from "./PageView";

/** 模块级常量里存中英成对文案，组件内用 t 取当前语言（prompt 会发给模型，必须跟着界面语言走） */
const ASK_SUBMENU: Array<{ label: [string, string]; prompt: [string, string] }> = [
  {
    label: ["举个例子", "Example"],
    prompt: [
      "针对我选中的这段话，举一个具体例子，并说明它对应哪个概念。",
      "Give a concrete example for the passage I selected, and explain which concept it maps to.",
    ],
  },
  {
    label: ["形象化解释", "Analogy"],
    prompt: [
      "针对我选中的这段话，用形象的类比解释清楚，再说这个类比的边界在哪。",
      "Explain the passage I selected with a vivid analogy, then say where that analogy breaks down.",
    ],
  },
  {
    label: ["快速例题", "Quick quiz"],
    prompt: [
      "针对我选中的这段话，出一道小题并给出解题过程。",
      "Write a short question about the passage I selected and show the worked solution.",
    ],
  },
  {
    label: ["拆成步骤", "Step by step"],
    prompt: [
      "把选中内容涉及的方法拆成可以照着做的步骤，每一步说明为什么。",
      "Turn the method in my selection into steps I can follow, and explain why each step matters.",
    ],
  },
  {
    label: ["补个反例", "Counterexample"],
    prompt: [
      "针对我选中的这段话，给一个反例，说明错在哪里。",
      "Give a counterexample for the passage I selected and explain where it goes wrong.",
    ],
  },
];

export function Reader({ nb, nodeId }: { nb: Notebook; nodeId: string }) {
  const t = useT();
  const bodies = useApp((s) => s.bodies);
  const openNode = useApp((s) => s.openNode);
  const generating = useApp((s) => s.generating);
  const generateNode = useApp((s) => s.generateNode);
  const generateRange = useApp((s) => s.generateRange);
  const generatePage = useApp((s) => s.generatePage);
  const addHighlight = useApp((s) => s.addHighlight);
  const removeHighlight = useApp((s) => s.removeHighlight);
  const saveBody = useApp((s) => s.saveBody);
  const ensureBody = useApp((s) => s.ensureBody);
  const addAttachments = useApp((s) => s.addAttachments);
  const toggleAttachmentInherit = useApp((s) => s.toggleAttachmentInherit);
  const removeAttachmentById = useApp((s) => s.removeAttachmentById);
  const previewAttachment = useApp((s) => s.previewAttachment);
  const setChatOpen = useApp((s) => s.setChatOpen);
  const setSelection = useApp((s) => s.setSelection);
  const sendChat = useApp((s) => s.sendChat);
  const error = useApp((s) => s.error);

  const node = nb.nodes.find((n) => n.id === nodeId);
  const body = bodies[nodeId] ?? "";
  const [mode, setMode] = useState<"read" | "source">("read");
  const [draft, setDraft] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "pending" | "saved">("idle");
  const [menu, setMenu] = useState<{ x: number; y: number; text: string } | null>(null);
  const [askOpen, setAskOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const draftRef = useRef("");
  const dirtyRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const nodeIdRef = useRef(nodeId);
  nodeIdRef.current = nodeId;

  // 写入指定节点：用闭包里的 id，避免切标签时把旧草稿存进新节点
  const flushTo = useCallback(
    async (id: string) => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (!dirtyRef.current) return;
      dirtyRef.current = false;
      await saveBody(id, draftRef.current);
      setSaveState("saved");
    },
    [saveBody],
  );

  useEffect(() => {
    setMode("read");
    setSaveState("idle");
    dirtyRef.current = false;
    draftRef.current = "";
    void ensureBody(nodeId);
    // 离开这一页前先把未落盘的改动写掉，切标签不会丢编辑
    return () => {
      void flushTo(nodeId);
    };
  }, [nodeId, ensureBody, flushTo]);

  useEffect(() => {
    if (mode !== "source") return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void flushTo(nodeIdRef.current);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, flushTo]);

  const openSource = () => {
    setDraft(body);
    draftRef.current = body;
    dirtyRef.current = false;
    setSaveState("idle");
    setMode("source");
  };

  const onDraftChange = (value: string) => {
    setDraft(value);
    draftRef.current = value;
    dirtyRef.current = true;
    setSaveState("pending");
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      void flushTo(nodeIdRef.current);
    }, 900);
  };

  const running = !!generating[nodeId] || node?.status === "running";
  const path = useMemo(() => breadcrumb(nb, nodeId), [nb, nodeId]);

  if (!node) return <div className="p-8 text-sm text-ink3">{t("节点不存在", "Node not found")}</div>;

  const isPage = node.kind === "page";
  const localSources = (node.sources ?? []).filter((s) => s.kind !== "web");
  const webSources = (node.sources ?? []).filter((s) => s.kind === "web");

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-border px-6 py-3">
        <div className="min-w-0 flex-1">
          <div className="mb-0.5 truncate text-[11px] text-ink3">{path}</div>
          <div className="flex items-center gap-2">
            <h1 className="truncate text-[17px] font-semibold">{node.title}</h1>
            {running && <span className="ax-badge ax-badge-run">{t("生成中", "Generating")}</span>}
            {node.status === "failed" && <span className="ax-badge ax-badge-fail">{t("失败", "Failed")}</span>}
          </div>
        </div>
      </header>

      <header className="flex items-center gap-1.5 border-b border-border px-4 py-1.5">
        {running ? (
          <span className="text-[11px] text-mutedfg">
            {t("正在生成，可先读上面已出的部分…", "Generating — you can read the parts already produced above…")}
          </span>
        ) : isPage ? (
          <button
            className="ax-btn ax-btn-ghost"
            onClick={() => {
              if (node.parentId && node.pageKind) {
                void generatePage(node.parentId, node.pageKind as ComponentKind);
              }
            }}
          >
            {t("重新生成组件", "Regenerate component")}
          </button>
        ) : (
          <>
            <button className="ax-btn ax-btn-ghost" onClick={() => void generateNode(node.id)}>
              {node.status === "done"
                ? t("重新生成", "Regenerate")
                : node.status === "failed"
                  ? t("重试", "Retry")
                  : t("生成这一页", "Generate this page")}
            </button>
            <button
              className="ax-btn ax-btn-ghost"
              title={t("连未生成的下一级一起排进后台队列", "Queue ungenerated child levels in the background")}
              onClick={() => void generateRange(node.id)}
            >
              {node.kind === "root"
                ? t("生成全本", "Generate whole notebook")
                : node.kind === "chapter"
                  ? t("生成本章及以下", "Generate this chapter and below")
                  : t("生成本节及以下", "Generate this section and below")}
            </button>
            {node.status === "done" && (
              <>
                <span className="mx-1 h-4 w-px bg-border" />
                <button
                  className={`ax-chip ${mode === "read" ? "ax-chip-active" : ""}`}
                  onClick={() => void flushTo(node.id).then(() => setMode("read"))}
                  title={t("渲染后的阅读视图", "Rendered reading view")}
                >
                  {t("阅读", "Reading")}
                </button>
                <button
                  className={`ax-chip ${mode === "source" ? "ax-chip-active" : ""}`}
                  onClick={openSource}
                  title={t("直接编辑这份 Markdown 源文件", "Edit this Markdown source file directly")}
                >
                  {t("源码", "Source")}
                </button>
                {mode === "source" && (
                  <span className="text-[11px] text-ink3">
                    {saveState === "pending"
                      ? t("未保存 · 停止输入后自动保存", "Unsaved · autosaves when you stop typing")
                      : saveState === "saved"
                        ? t("已保存", "Saved")
                        : t("Ctrl+S 保存", "Ctrl+S to save")}
                  </span>
                )}
              </>
            )}
          </>
        )}
        <div className="flex-1" />
        {node.goal && (
          <span className="max-w-[420px] truncate text-[11px] text-ink3">
            {t("目标：", "Goal: ")}
            {node.goal}
          </span>
        )}
      </header>

      {error && node.status === "failed" && (
        <div className="border-b border-[var(--ax-err-line)] bg-[var(--ax-err-soft)] px-6 py-2 text-xs text-[var(--ax-err)]">
          {error}
        </div>
      )}

      <div
        className="ax-scroll min-h-0 flex-1 overflow-y-auto"
        onMouseUp={(e) => {
          const sel = window.getSelection();
          const text = sel?.toString().trim() ?? "";
          if (!text || text.length > 500 || !sel?.rangeCount) {
            setMenu(null);
            setAskOpen(false);
            return;
          }
          const rect = sel.getRangeAt(0).getBoundingClientRect();
          setMenu({ x: rect.left + rect.width / 2, y: rect.bottom + 8, text });
          setAskOpen(false);
          void e;
        }}
      >
        {mode === "source" && !isPage ? (
          <CodeEditor value={draft} onChange={onDraftChange} dark={document.documentElement.classList.contains("dark")} />
        ) : isPage ? (
          <PageView node={node} />
        ) : body ? (
          <div className="mx-auto w-full max-w-[720px] px-6 py-8">
            <Markdown text={body} highlights={node.highlights} />
            {running && <span className="inline-block h-4 w-1.5 animate-pulse bg-ink3 align-middle" />}
          </div>
        ) : running ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-mutedfg">{t("正在生成…", "Generating…")}</div>
        ) : (
          <div className="mx-auto flex w-full max-w-[720px] flex-col items-start px-6 py-16">
            <div className="ax-eyebrow mb-2">{t("这一页还没生成", "This page hasn't been generated yet")}</div>
            <p className="mb-4 max-w-[520px] text-sm text-mutedfg">
              {node.kind === "root"
                ? t(
                    "根节点只会生成一份领域概览：学习地图 + 路线建议，不连带生成子节点。",
                    "The root node generates a domain overview only: a learning map plus a suggested path. Child nodes are not generated.",
                  )
                : node.kind === "chapter"
                  ? t(
                      "章节节点只会生成本章概览：结构导航 + 要点 + 学习目标，不搬运子节正文。",
                      "A chapter node generates a chapter overview only: structure, key points, and learning goals. Subsection text is not copied.",
                    )
                  : t("点一下就会生成本节正文，生成完可以直接读。", "One click generates this section's text, ready to read when done.")}
            </p>
            <div className="flex gap-2">
              <button className="ax-btn ax-btn-primary" onClick={() => void generateNode(node.id)}>
                {t("生成这一页", "Generate this page")}
              </button>
            </div>
          </div>
        )}

      </div>

      {(mode === "read" || isPage) && (
        <footer className="shrink-0 border-t border-border bg-bg">
          <details>
            <summary className="cursor-pointer px-6 py-2.5 text-[11px] text-ink3">
              {t("本节依据", "Sources for this section")}
            </summary>
            <div className="ax-scroll max-h-[42vh] space-y-4 overflow-y-auto border-t border-border px-6 py-3">
              {localSources.length > 0 && (
                <div>
                  <div className="ax-eyebrow mb-1.5">{t("本机资料", "Local files")}</div>
                  <div className="space-y-1">
                    {localSources.map((s) => {
                      const pid =
                        s.kind === "page" && s.path
                          ? s.path.replace(/^nodes\//, "").replace(/\.md$/, "")
                          : null;
                      const canJump = !!pid && nb.nodes.some((n) => n.id === pid);
                      const owner =
                        s.kind === "local" && s.path
                          ? nb.nodes.find((n) => n.attachments?.some((a) => a.path === s.path))
                          : undefined;
                      const att = owner?.attachments?.find((a) => a.path === s.path);
                      return (
                        <div key={`${s.kind}-${s.id}-${s.title}`} className="flex items-center gap-2 text-[11px] text-mutedfg">
                          <span className="ax-badge">
                            {s.kind === "local" ? t("本机资料", "Local file") : t("笔记本内页", "Notebook page")}
                          </span>
                          {canJump ? (
                            <button
                              className="min-w-0 flex-1 truncate text-left hover:text-fg hover:underline"
                              title={t(`跳到「${s.title}」`, `Go to “${s.title}”`)}
                              onClick={() => {
                                if (pid) void openNode(pid);
                              }}
                            >
                              {s.title}
                            </button>
                          ) : owner && att ? (
                            <button
                              className="min-w-0 flex-1 truncate text-left hover:text-fg hover:underline"
                              title={t("预览附件", "Preview attachment")}
                              onClick={() => void previewAttachment(owner.id, att.id)}
                            >
                              {s.title}
                            </button>
                          ) : (
                            <span className="min-w-0 flex-1 truncate">{s.title}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {webSources.length > 0 && (
                <div className={localSources.length > 0 ? "border-t border-border pt-3" : ""}>
                  <div className="ax-eyebrow mb-1.5">{t("网页", "Web")}</div>
                  <div className="space-y-1.5">
                    {webSources.map((s) => (
                      <div key={`${s.id}-${s.url}`} className="min-w-0">
                        <a
                          className="block truncate text-[11.5px] text-mutedfg hover:text-fg hover:underline"
                          href={s.url}
                          rel="noreferrer"
                          title={s.url}
                          onClick={(e) => {
                            e.preventDefault();
                            if (s.url) openExternal(s.url);
                          }}
                        >
                          {s.title}
                        </a>
                        <div className="truncate text-[10px] text-ink3">{s.url}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="border-t border-border pt-3">
                <div className="ax-eyebrow mb-1.5">
                  {t(
                    `我的高亮（${(node.highlights ?? []).length}）`,
                    `My highlights (${(node.highlights ?? []).length})`,
                  )}
                </div>
                <div className="space-y-1.5">
                  {(node.highlights ?? []).map((h) => (
                    <div key={h.id} className="flex items-start gap-2 rounded-md border border-border px-2.5 py-2">
                      <div className="min-w-0 flex-1 text-[11.5px] leading-relaxed text-ink2">「{h.text}」</div>
                      <button
                        className="ax-icon-btn"
                        title={t("取消高亮", "Remove highlight")}
                        onClick={() => void removeHighlight(node.id, h.id)}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  {(node.highlights ?? []).length === 0 && (
                    <div className="text-[11px] text-ink3">
                      {t("还没有高亮。正文里选中一段，点「高亮」。", "No highlights yet. Select some text and click Highlight.")}
                    </div>
                  )}
                </div>
              </div>

              <div className={localSources.length > 0 || webSources.length > 0 || (node.highlights ?? []).length > 0 ? "border-t border-border pt-3" : ""}>
                <div className="ax-eyebrow mb-1.5">{t("附件", "Attachments")}</div>
                <div className="space-y-1">
                  {(node.attachments ?? []).map((a) => (
                    <div key={a.id} className="flex items-center gap-2 text-[11px] text-mutedfg">
                      <span className="ax-dot" style={{ background: "var(--ax-ink-3)" }} />
                      <button
                        className="min-w-0 flex-1 truncate text-left hover:text-fg hover:underline"
                        title={t("预览附件", "Preview attachment")}
                        onClick={() => void previewAttachment(node.id, a.id)}
                      >
                        {a.name}
                      </button>
                      <button
                        className="ax-badge"
                        title={t("切换后：继承到下级 / 只在本层生效", "Toggle: inherit below / this level only")}
                        onClick={() => void toggleAttachmentInherit(node.id, a.id)}
                      >
                        {a.inherit ? t("继承到下级", "Inherited below") : t("仅本层", "This level")}
                      </button>
                      <button
                        className="ax-icon-btn"
                        title={t("移除附件", "Remove attachment")}
                        onClick={() => void removeAttachmentById(node.id, a.id)}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <button className="ax-btn ax-btn-ghost" onClick={() => fileRef.current?.click()}>
                    {t("＋ 添加附件（可多选）", "＋ Add attachments (multiple allowed)")}
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      const files = Array.from(e.target.files ?? []);
                      if (files.length) void addAttachments(node.id, files);
                      e.target.value = "";
                    }}
                  />
                </div>
              </div>
            </div>
          </details>
        </footer>
      )}

      {menu && (
        <div
          className="ax-panel-float fixed z-50 flex flex-col gap-1 px-2 py-1.5"
          style={{ left: menu.x, top: menu.y, transform: "translateX(-50%)" }}
          onMouseUp={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-1">
            <button
              className="ax-btn ax-btn-ghost h-7"
              onClick={() => {
                void addHighlight(node.id, menu.text);
                setMenu(null);
              }}
            >
              {t("高亮", "Highlight")}
            </button>
            <button
              className="ax-btn ax-btn-ghost h-7"
              onClick={() => {
                setSelection(menu.text);
                setChatOpen(true);
                setMenu(null);
              }}
            >
              {t("问 AI", "Ask AI")}
            </button>
            <button
              className="ax-btn ax-btn-ghost h-7"
              onClick={() => setAskOpen((v) => !v)}
            >
              {t("AI 追问", "AI follow-up")} <span className="text-[9px] text-ink3">▾</span>
            </button>
            <button
              className="ax-btn ax-btn-ghost h-7"
              onClick={() => {
                void navigator.clipboard.writeText(menu.text);
                setMenu(null);
              }}
            >
              {t("复制", "Copy")}
            </button>
          </div>
          {askOpen && (
            <div className="flex flex-wrap gap-1 border-t border-border pt-1">
              {ASK_SUBMENU.map((a) => (
                <button
                  key={a.label[0]}
                  className="ax-btn ax-btn-ghost h-7"
                  onClick={() => {
                    setSelection(menu.text);
                    setChatOpen(true);
                    setMenu(null);
                    setAskOpen(false);
                    void sendChat(t(a.prompt[0], a.prompt[1]));
                  }}
                >
                  {t(a.label[0], a.label[1])}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function breadcrumb(nb: Notebook, nodeId: string): string {
  const byId = new Map(nb.nodes.map((n) => [n.id, n]));
  const parts: string[] = [];
  let cur = byId.get(nodeId);
  while (cur) {
    if (cur.kind !== "root") parts.unshift(cur.title);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return parts.join(" › ");
}

export function nodeTitle(nb: Notebook, nodeId: string): string {
  const title = nb.nodes.find((n) => n.id === nodeId)?.title;
  if (title) return title;
  return pick(useApp.getState().settings.language, "未命名", "Untitled");
}

export function isNodeGenerating(node: Node | undefined, running: boolean): boolean {
  return running || node?.status === "running";
}
