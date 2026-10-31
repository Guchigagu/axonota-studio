import { useMemo, useRef, useState } from "react";
import type { Node, Notebook } from "@nb/core";
import { useApp } from "../store";
import { useT } from "../i18n";

interface Props {
  nb: Notebook;
}

export function StructureTree({ nb }: Props) {
  const t = useT();
  const openNode = useApp((s) => s.openNode);
  const selectTab = useApp((s) => s.selectTab);
  const generateNode = useApp((s) => s.generateNode);
  const generateRange = useApp((s) => s.generateRange);
  const activeTabId = useApp((s) => s.activeTabId);
  const tabs = useApp((s) => s.tabs);
  const generating = useApp((s) => s.generating);
  const addChildNode = useApp((s) => s.addChildNode);
  const addAttachments = useApp((s) => s.addAttachments);
  const reorderNode = useApp((s) => s.reorderNode);
  const moveNode = useApp((s) => s.moveNode);
  const restructureNode = useApp((s) => s.restructureNode);
  const renameNode = useApp((s) => s.renameNode);
  const deleteNode = useApp((s) => s.deleteNode);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [addParentId, setAddParentId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [ctx, setCtx] = useState<{ nodeId: string; x: number; y: number } | null>(null);
  const [editing, setEditing] = useState<{ nodeId: string; value: string } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropId, setDropId] = useState<string | null>(null);
  const [genMenu, setGenMenu] = useState(false);
  const [restructureOpen, setRestructureOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [scopeWhole, setScopeWhole] = useState(true);
  const attachRef = useRef<HTMLInputElement>(null);

  const activeNodeId = tabs.find((t) => t.id === activeTabId)?.nodeId ?? null;
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    const byId = new Map(nb.nodes.map((n) => [n.id, n]));
    const keep = new Set<string>();
    for (const n of nb.nodes) {
      if (!n.title.toLowerCase().includes(q)) continue;
      keep.add(n.id);
      let pid = n.parentId;
      while (pid) {
        keep.add(pid);
        pid = byId.get(pid)?.parentId ?? null;
      }
    }
    return keep;
  }, [query, nb.nodes]);
  const childrenOf = useMemo(() => {
    const map = new Map<string | null, Node[]>();
    for (const n of nb.nodes) {
      const list = map.get(n.parentId) ?? [];
      list.push(n);
      map.set(n.parentId, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.order - b.order);
    return map;
  }, [nb.nodes]);

  const roots = childrenOf.get(null) ?? [];
  const chapterCount = nb.nodes.filter((n) => n.kind === "chapter").length;
  const sectionCount = nb.nodes.filter((n) => n.kind === "section").length;
  const collapsibleIds = nb.nodes.filter((n) => (childrenOf.get(n.id) ?? []).length > 0).map((n) => n.id);
  const allCollapsed = collapsibleIds.length > 0 && collapsibleIds.every((id) => collapsed[id]);
  const activeNode = nb.nodes.find((n) => n.id === activeNodeId);
  /** 生成范围以章/节为准；当前选的是组件页则落到它所属的节 */
  const rangeTarget =
    activeNode && activeNode.kind !== "page"
      ? activeNode
      : nb.nodes.find((n) => n.id === activeNode?.parentId) ?? null;
  const attachTarget = activeNode ?? roots[0] ?? null;

  function toggleAll() {
    const next: Record<string, boolean> = {};
    for (const id of collapsibleIds) next[id] = !allCollapsed;
    setCollapsed(next);
  }

  async function createSection() {
    const title = newTitle.trim();
    if (!title) return;
    const parentId =
      addParentId ??
      (activeNode?.kind === "section"
        ? activeNode.parentId
        : activeNode?.kind === "chapter"
          ? activeNode.id
          : (childrenOf.get(roots[0]?.id ?? "") ?? [])[0]?.id ?? null);
    if (!parentId) return;
    await addChildNode(parentId, title);
    setNewTitle("");
    setAdding(false);
    setAddParentId(null);
  }

  function openContextMenu(node: Node, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const w = 168;
    const h = node.kind === "root" || node.kind === "page" ? 84 : 116;
    setCtx({
      nodeId: node.id,
      x: Math.max(8, Math.min(e.clientX, window.innerWidth - w - 8)),
      y: Math.max(8, Math.min(e.clientY, window.innerHeight - h - 8)),
    });
  }

  async function commitRename() {
    if (!editing) return;
    const title = editing.value.trim();
    setEditing(null);
    if (title) await renameNode(editing.nodeId, title);
  }

  function startRename(node: Node) {
    setCtx(null);
    setEditing({ nodeId: node.id, value: node.title });
  }

  /** 拖动落位：同层重排；拖到章/根上或跨层则换父节点后重排 */
  async function handleDrop(target: Node) {
    const draggedId = dragId;
    setDragId(null);
    setDropId(null);
    if (!draggedId || draggedId === target.id) return;
    const dragged = nb.nodes.find((n) => n.id === draggedId);
    if (!dragged) return;
    const siblingsOf = (parentId: string) =>
      (childrenOf.get(parentId) ?? []).filter((n) => n.id !== draggedId);

    let parentId: string;
    let index: number;
    const rootId = roots[0]?.id;
    if (!rootId) return;
    if (dragged.kind === "chapter") {
      // 章只在根下重排：拖到根上落到末尾，拖到别的章上插在它后面
      parentId = rootId;
      if (target.kind === "root") {
        index = siblingsOf(rootId).length;
      } else {
        const list = siblingsOf(rootId);
        const at = list.findIndex((n) => n.id === target.id);
        index = at < 0 ? list.length : at + 1;
      }
    } else if (target.kind === "root" || target.kind === "chapter") {
      // 节拖到章/根上：放进这个节点，排在最后
      parentId = target.id;
      index = siblingsOf(target.id).length;
    } else if (target.parentId) {
      parentId = target.parentId;
      const list = siblingsOf(parentId);
      const at = list.findIndex((n) => n.id === target.id);
      index = at < 0 ? list.length : at + 1;
    } else {
      return;
    }
    if (parentId === dragged.parentId) {
      await reorderNode(dragged.id, index);
      return;
    }
    await moveNode(dragged.id, parentId);
    await reorderNode(dragged.id, index);
  }

  const render = (node: Node, depth: number): React.ReactNode => {
    if (visible && !visible.has(node.id)) return null;
    // 组件页当作活页纸：挂在所属节下，用短名字和图标，而不是长标题
    if (node.kind === "page") {
      const key = node.pageKind ?? "";
      const label = PAGE_LABEL[key] ? t(PAGE_LABEL[key], PAGE_LABEL_EN[key]) : node.title;
      return (
        <div
          key={node.id}
          draggable
          className={`ax-tree-row relative ${activeNodeId === node.id ? "is-active" : ""} ${dropId === node.id ? "ring-1 ring-accent" : ""}`}
          style={{ paddingLeft: 8 + depth * 14 + 24 }}
          onClick={() => void openNode(node.id)}
          onDragStart={(e) => {
            setDragId(node.id);
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", node.id);
          }}
          onDragEnd={() => {
            setDragId(null);
            setDropId(null);
          }}
          onDragOver={(e) => {
            if (!dragId || dragId === node.id) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            setDropId(node.id);
          }}
          onDragLeave={() => setDropId((d) => (d === node.id ? null : d))}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void handleDrop(node);
          }}
          onContextMenu={(e) => openContextMenu(node, e)}
          title={node.title}
        >
          <PageIcon kind={node.pageKind ?? ""} />
          {editing?.nodeId === node.id ? (
            <input
              autoFocus
              className="ax-input h-6 flex-1 py-0 text-[12px]"
              value={editing.value}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setEditing({ nodeId: node.id, value: e.target.value })}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") void commitRename();
                else if (e.key === "Escape") setEditing(null);
              }}
              onBlur={() => void commitRename()}
            />
          ) : (
            <span className="flex-1 truncate">{label}</span>
          )}
          {generating[node.id] || node.status === "running" ? (
            <span className="ax-badge ax-badge-running h-[16px] px-1 text-[9px]">{t("生成中", "Generating")}</span>
          ) : node.status === "failed" ? (
            <span className="ax-badge h-[16px] px-1 text-[9px] text-[var(--ax-err)]">{t("失败", "Failed")}</span>
          ) : null}
        </div>
      );
    }
    const kids = childrenOf.get(node.id) ?? [];
    const isCollapsed = visible ? false : collapsed[node.id] ?? (depth >= 1 && !containsActive(kids, activeNodeId));
    return (
      <div key={node.id}>
        <div
          draggable
          className={`ax-tree-row ${activeNodeId === node.id ? "is-active" : ""} ${dropId === node.id ? "ring-1 ring-accent" : ""}`}
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={() => void openNode(node.id)}
          onDoubleClick={() => {
            if (node.status !== "done") void generateNode(node.id);
          }}
          onDragStart={(e) => {
            setDragId(node.id);
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", node.id);
          }}
          onDragEnd={() => {
            setDragId(null);
            setDropId(null);
          }}
          onDragOver={(e) => {
            if (!dragId || dragId === node.id) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            setDropId(node.id);
          }}
          onDragLeave={() => setDropId((d) => (d === node.id ? null : d))}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void handleDrop(node);
          }}
          onContextMenu={(e) => openContextMenu(node, e)}
          title={t(
            `${node.title}（可拖动排序；拖到别的章上可跨层移动）`,
            `${node.title} (drag to reorder; drop onto a chapter to move across levels)`,
          )}
        >
          {kids.length > 0 ? (
            <button
              className="grid h-4 w-4 place-items-center text-[10px] text-ink3"
              onClick={(e) => {
                e.stopPropagation();
                setCollapsed((c) => ({ ...c, [node.id]: !isCollapsed }));
              }}
            >
              {isCollapsed ? "▸" : "▾"}
            </button>
          ) : (
            <span className="h-4 w-4" />
          )}
          <StatusDot status={node.status} running={!!generating[node.id]} />
          {editing?.nodeId === node.id ? (
            <input
              autoFocus
              className="ax-input h-6 flex-1 py-0 text-[12px]"
              value={editing.value}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setEditing({ nodeId: node.id, value: e.target.value })}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") void commitRename();
                else if (e.key === "Escape") setEditing(null);
              }}
              onBlur={() => void commitRename()}
            />
          ) : (
            <span className="flex-1 truncate">{node.title}</span>
          )}
          {node.createdBy === "user" && <span className="ax-badge">{t("我", "Me")}</span>}
        </div>
        {!isCollapsed && kids.map((k) => render(k, depth + 1))}
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-baseline gap-1.5">
          <span className="ax-eyebrow">{t("结构", "Structure")}</span>
          <span className="truncate text-[10px] text-ink3">
            {t(`${chapterCount} 章 · ${sectionCount} 节`, `${chapterCount} chapters · ${sectionCount} sections`)}
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            className={`ax-icon-btn ${adding ? "bg-surface2 text-fg" : ""}`}
            title={t("新建节（在当前章下追加）", "New section (append under current chapter)")}
            onClick={() => {
              setAdding((v) => !v);
              setNewTitle("");
              setAddParentId(null);
            }}
          >
            ＋
          </button>
          <button
            className="ax-icon-btn"
            title={allCollapsed ? t("展开全部", "Expand all") : t("折叠全部", "Collapse all")}
            onClick={toggleAll}
          >
            {allCollapsed ? "▸" : "▾"}
          </button>
          <div className="relative">
            <button
              className="ax-icon-btn"
              title={t("生成范围：当前页 / 当前章及以下 / 整本", "Generate scope: current page / current chapter and below / whole book")}
              onClick={() => setGenMenu((v) => !v)}
            >
              ⤓
            </button>
            {genMenu && (
              <div className="ax-panel-float absolute right-0 top-7 z-40 w-44 p-1">
                <button
                  className="block w-full rounded px-2 py-1.5 text-left text-[11.5px] hover:bg-surface"
                  disabled={!rangeTarget}
                  onClick={() => {
                    if (rangeTarget) void generateNode(rangeTarget.id);
                    setGenMenu(false);
                  }}
                >
                  {t("只生成当前页", "Generate current page only")}
                </button>
                <button
                  className="block w-full rounded px-2 py-1.5 text-left text-[11.5px] hover:bg-surface"
                  disabled={!rangeTarget}
                  onClick={() => {
                    if (rangeTarget) void generateRange(rangeTarget.id);
                    setGenMenu(false);
                  }}
                >
                  {rangeTarget?.kind === "root"
                    ? t("生成整本", "Generate whole book")
                    : t("当前章及以下", "Current chapter and below")}
                </button>
                <button
                  className="block w-full rounded px-2 py-1.5 text-left text-[11.5px] hover:bg-surface"
                  disabled={!roots[0]}
                  onClick={() => {
                    if (roots[0]) void generateRange(roots[0].id);
                    setGenMenu(false);
                  }}
                >
                  {t("整本（含所有未生成页）", "Whole book (all ungenerated pages)")}
                </button>
              </div>
            )}
          </div>
          <button
            className={`ax-icon-btn ${restructureOpen ? "bg-surface2 text-fg" : ""}`}
            title={t("用 AI 调整结构（只动结构，已写正文的节点保留）", "Restructure with AI (structure only; nodes with written content are kept)")}
            onClick={() => setRestructureOpen((v) => !v)}
          >
            ✧
          </button>
        </div>
      </div>
      {adding && (
        <div className="border-b border-border px-2 py-1.5">
          <input
            autoFocus
            className="ax-input h-7 py-0 text-[12px]"
            placeholder={t("新节标题，回车创建", "New section title, press Enter to create")}
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void createSection();
              if (e.key === "Escape") setAdding(false);
            }}
          />
        </div>
      )}
      {restructureOpen && (
        <div className="space-y-1.5 border-b border-border px-2 py-2">
          <div className="flex items-center gap-1.5">
            <button
              className={`ax-chip h-6 px-2 text-[11px] ${scopeWhole ? "ax-chip-active" : ""}`}
              onClick={() => setScopeWhole(true)}
            >
              {t("整本", "Whole book")}
            </button>
            <button
              className={`ax-chip h-6 px-2 text-[11px] ${scopeWhole ? "" : "ax-chip-active"}`}
              onClick={() => setScopeWhole(false)}
              disabled={!rangeTarget || rangeTarget.kind === "root"}
              title={t("只调整当前章的结构", "Only restructure the current chapter")}
            >
              {t("当前章", "Current chapter")}
            </button>
            <span className="text-[10px] text-ink3">{t("已写正文的节点不改动", "Nodes with content are left unchanged")}</span>
          </div>
          <textarea
            className="ax-input h-16 resize-y text-[12px]"
            placeholder={t(
              "例如：第三章拆成两章；把「进阶」小节挪到第二章末尾",
              "e.g. split chapter 3 into two; move the “Advanced” section to the end of chapter 2",
            )}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
          />
          <div className="flex items-center gap-1.5">
            <button
              className="ax-btn ax-btn-primary h-7 text-[11.5px]"
              disabled={!instruction.trim()}
              onClick={() => {
                void restructureNode(scopeWhole ? null : rangeTarget?.id ?? null, instruction).then(() => {
                  setInstruction("");
                  setRestructureOpen(false);
                });
              }}
            >
              {t("应用调整", "Apply")}
            </button>
            <button className="ax-btn ax-btn-ghost h-7 text-[11.5px]" onClick={() => setRestructureOpen(false)}>
              {t("取消", "Cancel")}
            </button>
          </div>
        </div>
      )}
      <div className="ax-scroll flex-1 overflow-y-auto p-1">
        <button
          className={`ax-tree-row mb-1 w-full ${activeTabId === "mindmap" ? "is-active" : ""}`}
          onClick={() => selectTab("mindmap")}
          title={t("全书思维导图", "Whole-book mind map")}
        >
          <MapIcon />
          <span className="flex-1 truncate text-left">{t("全书导图", "Whole-book map")}</span>
        </button>
        {roots.map((r) => render(r, 0))}
        {visible && visible.size === 0 && (
          <div className="px-3 py-4 text-[11px] text-ink3">{t("没有匹配的节点", "No matching nodes")}</div>
        )}
      </div>
      <div className="space-y-1.5 border-t border-border p-2">
        <input
          className="ax-input h-7 py-0 text-[12px]"
          placeholder={t("搜索标题…", "Search titles…")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          className="ax-btn ax-btn-ghost h-7 w-full text-[12px]"
          disabled={!attachTarget}
          title={attachTarget ? t("给当前节点添加附件", "Attach files to the current node") : t("先选中一个节点", "Select a node first")}
          onClick={() => attachRef.current?.click()}
        >
          {t("📎 附件", "📎 Attachments")}
          {attachTarget && (attachTarget.attachments?.length ?? 0) > 0
            ? ` · ${attachTarget.attachments.length}`
            : ""}
        </button>
        <input
          ref={attachRef}
          type="file"
          multiple
          className="hidden"
          onChange={async (e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            const targetId = attachTarget?.id;
            if (targetId && files.length) await addAttachments(targetId, files);
          }}
        />
      </div>

      {ctx && (() => {
        const target = nb.nodes.find((n) => n.id === ctx.nodeId);
        if (!target) return null;
        const addParent = target.kind === "root" ? target.id : target.kind === "chapter" ? target.id : target.parentId;
        return (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setCtx(null)}
              onContextMenu={(e) => {
                e.preventDefault();
                setCtx(null);
              }}
            />
            <div
              className="fixed z-50 w-[168px] rounded-lg border border-border bg-card p-1 shadow-lg"
              style={{ left: ctx.x, top: ctx.y }}
            >
              <button
                className="block w-full rounded px-2.5 py-1.5 text-left text-xs hover:bg-surface"
                onClick={() => startRename(target)}
              >
                {t("重命名", "Rename")}
              </button>
              {target.kind !== "page" && addParent && (
                <button
                  className="block w-full rounded px-2.5 py-1.5 text-left text-xs hover:bg-surface"
                  onClick={() => {
                    setCtx(null);
                    setAddParentId(addParent);
                    setNewTitle("");
                    setAdding(true);
                  }}
                >
                  {target.kind === "root" ? t("新建一章", "New chapter") : t("新建节", "New section")}
                </button>
              )}
              {target.kind !== "root" && (
                <button
                  className="block w-full rounded px-2.5 py-1.5 text-left text-xs text-[var(--ax-err)] hover:bg-surface"
                  onClick={() => {
                    setCtx(null);
                    if (
                      confirm(
                        t(
                          `删除「${target.title}」及其下级？正文会移到回收站。`,
                          `Delete “${target.title}” and its children? Content will be moved to the Recycle Bin.`,
                        ),
                      )
                    ) {
                      void deleteNode(target.id);
                    }
                  }}
                >
                  {t("删除节点", "Delete node")}
                </button>
              )}
            </div>
          </>
        );
      })()}
    </div>
  );
}

/** 组件页在结构栏里的短名字，对齐设计稿中的活页纸 */
const PAGE_LABEL: Record<string, string> = {
  flashcards: "闪卡组",
  glossary: "术语 · 公式速查",
};

const PAGE_LABEL_EN: Record<string, string> = {
  flashcards: "Flashcards",
  glossary: "Glossary · Formulas",
};

function MapIcon() {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-ink3"
    >
      <rect x="3" y="5" width="6" height="4" rx="1" />
      <rect x="15" y="3" width="6" height="4" rx="1" />
      <rect x="15" y="15" width="6" height="4" rx="1" />
      <path d="M9 7h3a3 3 0 0 1 3 3v4M12 7v9a2 2 0 0 0 2 2h1" />
    </svg>
  );
}

function PageIcon({ kind }: { kind: string }) {
  const common = {
    width: 12,
    height: 12,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: "shrink-0 text-ink3",
  };
  if (kind === "glossary") {
    return (
      <svg {...common}>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M9 8h6M9 12h6M9 16h6M9 4v16" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M8 9h8M8 13h5" />
    </svg>
  );
}

function StatusDot({ status, running }: { status: Node["status"]; running: boolean }) {
  const color = running || status === "running"
    ? "var(--ax-accent)"
    : status === "done"
      ? "var(--ax-ok)"
      : status === "failed"
        ? "var(--ax-err)"
        : "var(--ax-ink-3)";
  return <span className="ax-dot" style={{ background: color, opacity: status === "todo" ? 0.5 : 1 }} />;
}

function containsActive(nodes: Node[], activeId: string | null): boolean {
  return nodes.some((n) => n.id === activeId);
}
