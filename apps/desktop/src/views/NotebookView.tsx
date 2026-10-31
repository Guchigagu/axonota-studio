import { useState } from "react";
import { useApp } from "../store";
import { useT } from "../i18n";
import { StructureTree } from "../components/StructureTree";
import { MindMap } from "../components/MindMap";
import { Reader } from "../components/Reader";
import { ChatPanel } from "../components/ChatPanel";
import { STYLE_PRESETS } from "@nb/core";
import { PRESET_EN } from "../lib/lang";

export function NotebookView() {
  const t = useT();
  const nb = useApp((s) => s.nb);
  const tabs = useApp((s) => s.tabs);
  const activeTabId = useApp((s) => s.activeTabId);
  const chatOpen = useApp((s) => s.chatOpen);
  const setChatOpen = useApp((s) => s.setChatOpen);
  const openHome = useApp((s) => s.openHome);
  const generating = useApp((s) => s.generating);
  const exportNotebook = useApp((s) => s.exportNotebook);
  const exportArchive = useApp((s) => s.exportArchive);
  const exportPdf = useApp((s) => s.exportPdf);
  const setNotebookStyle = useApp((s) => s.setNotebookStyle);
  const [styleOpen, setStyleOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [customStyle, setCustomStyle] = useState(nb?.style.startsWith("custom:") ? nb.style.slice(7) : "");

  if (!nb) return null;

  const tab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];
  const currentNode = tab.nodeId ? nb.nodes.find((n) => n.id === tab.nodeId) : undefined;
  const chapterNode = currentNode
    ? currentNode.kind === "chapter"
      ? currentNode
      : nb.nodes.find((n) => n.kind === "chapter" && n.id === currentNode.parentId)
    : undefined;
  const runningCount = Object.keys(generating).length;
  const done = nb.nodes.filter((n) => n.status === "done").length;
  const total = nb.nodes.length;
  const percent = total ? Math.round((done / total) * 100) : 0;

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 border-b border-border">
        <div className="flex w-[248px] shrink-0 items-center gap-2 border-r border-border px-3">
          <button className="ax-icon-btn" title={t("返回工作台", "Back to workspace")} onClick={openHome}>
            ←
          </button>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium">{nb.title}</div>
            <div className="text-[10px] text-ink3">
              {t(`${done}/${total} 节 · ${percent}%`, `${done}/${total} sections · ${percent}%`)}
            </div>
          </div>
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-2 px-3">
        <div className="hidden items-center gap-2 sm:flex">
          <div className="ax-progress w-[104px]">
            <div className="ax-progress-fill" style={{ width: `${percent}%` }} />
          </div>
          {runningCount > 0 && (
            <span className="text-[10px] text-ink3">
              {t(`${runningCount} 个正在生成`, `${runningCount} generating`)}
            </span>
          )}
        </div>
        <div className="flex-1" />
        <div className="relative">
          <button
            className={`ax-chip ${styleOpen ? "ax-chip-active" : ""}`}
            onClick={() => setStyleOpen((v) => !v)}
            title={t(
              "切换讲解风格，只影响之后生成或重新生成的页面",
              "Change the explanation style; only affects pages generated or regenerated afterwards",
            )}
          >
            {t("风格：", "Style: ")}
            {styleName(nb.style, t)}
          </button>
          {styleOpen && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setStyleOpen(false)} />
              <div className="absolute right-0 top-full z-30 mt-1 w-[304px] rounded-lg border border-border bg-card p-2 shadow-xl">
                <div className="mb-1 px-1 text-[11px] font-medium text-mutedfg">{t("讲解风格", "Explanation style")}</div>
                <div className="grid gap-0.5">
                  {STYLE_PRESETS.map((p) => (
                    <button
                      key={p.id}
                      className={`rounded-md px-2 py-1.5 text-left ${nb.style === p.id ? "bg-surface2" : "hover:bg-surface"}`}
                      onClick={() => {
                        void setNotebookStyle(p.id);
                        setStyleOpen(false);
                      }}
                    >
                      <div className="flex items-center gap-1.5 text-xs font-medium">
                        <span className="w-3 text-[10px]">{nb.style === p.id ? "✓" : ""}</span>
                        {t(p.name, PRESET_EN[p.id]?.name ?? p.name)}
                      </div>
                      <div className="mt-0.5 pl-[18px] text-[11px] leading-snug text-ink3">{t(p.description, PRESET_EN[p.id]?.desc ?? p.description)}</div>
                    </button>
                  ))}
                </div>
                <div className="mt-1.5 border-t border-border pt-2">
                  <div className="flex gap-1.5">
                    <input
                      className="ax-input h-7 flex-1 py-0 text-xs"
                      placeholder={t("自定义：一句话描述讲法", "Custom: describe the style in one sentence")}
                      value={customStyle}
                      onChange={(e) => setCustomStyle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && customStyle.trim()) {
                          void setNotebookStyle(`custom:${customStyle.trim()}`);
                          setStyleOpen(false);
                        }
                      }}
                    />
                    <button
                      className="ax-btn ax-btn-outline h-7 px-2 text-xs"
                      disabled={!customStyle.trim()}
                      onClick={() => {
                        void setNotebookStyle(`custom:${customStyle.trim()}`);
                        setStyleOpen(false);
                      }}
                    >
                      {t("使用", "Use")}
                    </button>
                  </div>
                  {nb.style.startsWith("custom:") && (
                    <div className="mt-1 px-0.5 text-[10px] text-ink3">
                      {t("当前自定义：", "Current custom: ")}
                      {nb.style.slice(7)}
                    </div>
                  )}
                </div>
                <div className="mt-1.5 px-0.5 text-[10px] text-ink3">
                  {t(
                    "已生成的页面保持原样；重新生成后按新风格写。",
                    "Generated pages stay unchanged; regenerated pages follow the new style.",
                  )}
                </div>
              </div>
            </>
          )}
        </div>
        <div className="relative">
          <button
            className={`ax-chip ${exportOpen ? "ax-chip-active" : ""}`}
            onClick={() => setExportOpen((v) => !v)}
            title={t("导出整本或当前章", "Export the whole book or the current chapter")}
          >
            {t("导出 ▾", "Export ▾")}
          </button>
          {exportOpen && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setExportOpen(false)} />
              <div className="absolute right-0 top-full z-30 mt-1 w-[268px] rounded-lg border border-border bg-card p-2 shadow-xl">
                <div className="mb-1 px-1 text-[11px] font-medium text-mutedfg">{t("整本", "Whole book")}</div>
                <div className="grid gap-0.5">
                  <ExportItem
                    label={t("Markdown（含高亮）", "Markdown (with highlights)")}
                    onClick={() => void exportNotebook("book")}
                    onDone={() => setExportOpen(false)}
                  />
                  <ExportItem
                    label={t("zip 归档（可再次导入）", "zip archive (re-importable)")}
                    onClick={() => void exportArchive("book")}
                    onDone={() => setExportOpen(false)}
                  />
                  <ExportItem
                    label={t("PDF（打印稿，另存为 PDF）", "PDF (print layout, save as PDF)")}
                    onClick={() => void exportPdf("book")}
                    onDone={() => setExportOpen(false)}
                  />
                </div>
                <div className="mb-1 mt-2 border-t border-border pt-2 px-1 text-[11px] font-medium text-mutedfg">
                  {t("当前章", "Current chapter")}
                  {chapterNode ? ` · ${chapterNode.title}` : t("（先在结构里选一节）", "(select a section in Structure first)")}
                </div>
                <div className="grid gap-0.5">
                  <ExportItem
                    label={t("Markdown（只这一章）", "Markdown (this chapter only)")}
                    disabled={!chapterNode}
                    onClick={() => chapterNode && void exportNotebook("chapter", chapterNode.id)}
                    onDone={() => setExportOpen(false)}
                  />
                  <ExportItem
                    label={t("zip 归档（只这一章）", "zip archive (this chapter only)")}
                    disabled={!chapterNode}
                    onClick={() => chapterNode && void exportArchive("chapter", chapterNode.id)}
                    onDone={() => setExportOpen(false)}
                  />
                  <ExportItem
                    label={t("PDF（只这一章）", "PDF (this chapter only)")}
                    disabled={!chapterNode}
                    onClick={() => chapterNode && void exportPdf("chapter", chapterNode.id)}
                    onDone={() => setExportOpen(false)}
                  />
                </div>
                <div className="mt-1.5 px-0.5 text-[10px] leading-snug text-ink3">
                  {t(
                    "导出写到「文档/Axonota Exports」。PDF 在系统打印里选「另存为 PDF」。",
                    "Exports go to Documents/Axonota Exports. For PDF, choose “Save as PDF” in the system print dialog.",
                  )}
                </div>
              </div>
            </>
          )}
        </div>
        <button
          className={`ax-btn ${chatOpen ? "ax-btn-primary" : "ax-btn-outline"}`}
          onClick={() => setChatOpen(!chatOpen)}
        >
          {t("AI 对话", "AI chat")}
        </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="w-[248px] flex-none border-r border-border bg-card">
          <StructureTree nb={nb} />
        </aside>

        <main className="min-w-0 flex-1">
          {tab.kind === "mindmap" ? (
            <MindMap nb={nb} />
          ) : tab.nodeId ? (
            <Reader nb={nb} nodeId={tab.nodeId} />
          ) : (
            <div className="grid h-full place-items-center text-sm text-ink3">
              {t("打开一个节点开始阅读", "Open a node to start reading")}
            </div>
          )}
        </main>

        {chatOpen && <ChatPanel />}
      </div>
    </div>
  );
}

function styleName(id: string, t: (zh: string, en: string) => string): string {
  if (id.startsWith("custom:")) return id.slice(7) || t("自定义", "Custom");
  const preset = STYLE_PRESETS.find((s) => s.id === id);
  return preset ? t(preset.name, PRESET_EN[preset.id]?.name ?? preset.name) : id;
}

function ExportItem({
  label,
  disabled,
  onClick,
  onDone,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  onDone: () => void;
}) {
  return (
    <button
      className="rounded-md px-2 py-1.5 text-left text-xs hover:bg-surface disabled:opacity-40 disabled:hover:bg-transparent"
      disabled={disabled}
      onClick={() => {
        onClick();
        onDone();
      }}
    >
      {label}
    </button>
  );
}
