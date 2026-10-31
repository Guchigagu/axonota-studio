import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Node, Notebook } from "@nb/core";
import { useApp } from "../store";
import { useT } from "../i18n";

/** 领域 → 章 → 节：左→右递归树，默认全展开；布局参考 preaxonote §4.5（Flex 递归 + DOM 测量竖脊线）。 */
export function MindMap({ nb }: { nb: Notebook }) {
  const t = useT();
  const openNode = useApp((s) => s.openNode);
  const generateNode = useApp((s) => s.generateNode);
  const generating = useApp((s) => s.generating);
  const tabs = useApp((s) => s.tabs);
  const activeTabId = useApp((s) => s.activeTabId);
  const renameNode = useApp((s) => s.renameNode);
  const deleteNode = useApp((s) => s.deleteNode);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ nodeId: string; x: number; y: number } | null>(null);
  const [editing, setEditing] = useState<{ nodeId: string; value: string } | null>(null);
  const [zoom, setZoom] = useState(1);
  const canvasRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  /** 适应画布：按当前缩放下的自然尺寸算一次，留出 64px 边距 */
  const fitCanvas = () => {
    const box = canvasRef.current;
    const inner = contentRef.current;
    if (!box || !inner) return;
    const w = inner.scrollWidth / zoom;
    const h = inner.scrollHeight / zoom;
    if (!w || !h) return;
    const next = Math.min((box.clientWidth - 64) / w, (box.clientHeight - 64) / h, 1.4);
    setZoom(Math.max(0.35, Math.round(next * 100) / 100));
  };

  const root = nb.nodes.find((n) => n.kind === "root") ?? null;
  const childrenOf = useMemo(() => {
    const map = new Map<string, Node[]>();
    for (const n of nb.nodes) {
      const list = map.get(n.parentId ?? "") ?? [];
      list.push(n);
      map.set(n.parentId ?? "", list);
    }
    for (const list of map.values()) list.sort((a, b) => a.order - b.order);
    return map;
  }, [nb.nodes]);

  const activeNodeId = tabs.find((t) => t.id === activeTabId)?.nodeId ?? null;
  const chapterCount = root ? (childrenOf.get(root.id) ?? []).length : 0;
  const sectionCount = nb.nodes.filter((n) => n.kind === "section").length;

  // 当前标签页对应节点滚到视口中央（preaxonote §4.5.3）
  useEffect(() => {
    if (!activeNodeId) return;
    const el = canvasRef.current?.querySelector(`[data-node-id="${activeNodeId}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
  }, [activeNodeId]);

  // 选中后 F2 改名，Esc 取消（preaxonote §4.5.4）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!selectedId || editing) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "F2") {
        e.preventDefault();
        startRename(selectedId);
      } else if (e.key === "Escape") {
        setSelectedId(null);
        setMenu(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function startRename(nodeId: string) {
    const node = nb.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    setEditing({ nodeId, value: node.title });
  }

  async function commitRename() {
    if (!editing) return;
    const title = editing.value.trim();
    setEditing(null);
    if (title) await renameNode(editing.nodeId, title);
  }

  function openMenu(nodeId: string, clientX: number, clientY: number) {
    const w = 168;
    const h = nodeId === root?.id ? 76 : 116;
    setSelectedId(nodeId);
    setMenu({
      nodeId,
      x: Math.max(8, Math.min(clientX, window.innerWidth - w - 8)),
      y: Math.max(8, Math.min(clientY, window.innerHeight - h - 8)),
    });
  }

  const treeProps: TreeProps = {
    childrenOf,
    selectedId,
    activeNodeId,
    generating,
    editing,
    chapterCount,
    sectionCount,
    onSelect: (id) => {
      setSelectedId(id);
      setMenu(null);
    },
    onOpen: (id) => void openNode(id),
    onMenu: openMenu,
    onGenerate: (id) => void generateNode(id),
    onEditChange: (value) => setEditing((cur) => (cur ? { ...cur, value } : cur)),
    onEditCommit: () => void commitRename(),
    onEditCancel: () => setEditing(null),
  };

  const menuNode = menu ? nb.nodes.find((n) => n.id === menu.nodeId) : null;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-8 pb-4 pt-6">
        <div className="mx-auto flex w-full max-w-[1180px] items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-1 flex items-center gap-2">
              <h1 className="ax-h1 truncate">{nb.title}</h1>
              {nb.webSearch ? (
                <span className="ax-badge ax-badge-run">{t("联网检索开", "Web search on")}</span>
              ) : (
                <span className="ax-badge">{t("联网检索关", "Web search off")}</span>
              )}
            </div>
            {nb.scope && <p className="max-w-[640px] text-sm text-mutedfg">{nb.scope}</p>}
          </div>
          <div className="flex-none text-right text-[11px] text-ink3">
            <div>
              {t(`${chapterCount} 章 · ${sectionCount} 节`, `${chapterCount} chapters · ${sectionCount} sections`)}
            </div>
            <div className="mt-0.5">
              {t("双击进入 · 右键增删改 · F2 改名", "Double-click to open · Right-click to edit · F2 to rename")}
            </div>
          </div>
        </div>
      </div>

      <div
        ref={canvasRef}
        className="ax-scroll min-h-0 flex-1 overflow-auto"
        onClick={() => setSelectedId(null)}
      >
        <div
          ref={contentRef}
          className="flex min-h-full w-max min-w-full items-center justify-start px-8 py-10"
          style={{ zoom }}
        >
          {root ? (
            <Tree node={root} {...treeProps} />
          ) : (
            <p className="text-sm text-mutedfg">
              {t("这个笔记本还没有结构，回首页重建大纲。", "This notebook has no structure yet. Return home to rebuild the outline.")}
            </p>
          )}
        </div>
      </div>

      <footer className="border-t border-border px-8 py-1.5">
        <div className="mx-auto flex w-full max-w-[1180px] flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-ink3">
          <Legend color="var(--ax-ok)" label={t("已生成", "Generated")} />
          <Legend color="var(--ax-accent)" label={t("生成中", "Generating")} />
          <Legend color="var(--ax-err)" label={t("失败可重试", "Failed, retry")} />
          <Legend color="var(--ax-ink-3)" label={t("未生成（悬停点生成）", "Not generated (hover to generate)")} />
          <div className="ml-auto flex items-center gap-2">
            <div className="flex items-center gap-1">
              <button
                className="ax-icon-btn h-6 w-6"
                title={t("缩小", "Zoom out")}
                onClick={() => setZoom((z) => Math.max(0.35, Math.round((z - 0.1) * 100) / 100))}
              >
                −
              </button>
              <span className="w-9 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
              <button
                className="ax-icon-btn h-6 w-6"
                title={t("放大", "Zoom in")}
                onClick={() => setZoom((z) => Math.min(2, Math.round((z + 0.1) * 100) / 100))}
              >
                ＋
              </button>
              <button
                className="text-ink3 underline-offset-2 hover:text-fg hover:underline"
                onClick={fitCanvas}
              >
                {t("适应画布", "Fit canvas")}
              </button>
            </div>
            {root && (
              <div className="flex items-center gap-3">
                <button
                  className="text-ink3 underline-offset-2 hover:text-fg hover:underline"
                  onClick={() => void openNode(root.id)}
                >
                  {t("领域概览", "Domain overview")}
                </button>
                <button
                  className="text-ink3 underline-offset-2 hover:text-fg hover:underline"
                  onClick={() => void generateNode(root.id)}
                >
                  {t("生成本页概览", "Generate overview")}
                </button>
              </div>
            )}
          </div>
        </div>
      </footer>

      {menu && menuNode && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu(null);
            }}
          />
          <div
            className="fixed z-50 w-[168px] rounded-lg border border-border bg-card p-1 shadow-lg"
            style={{ left: menu.x, top: menu.y }}
          >
            <MenuItem
              onClick={() => {
                setMenu(null);
                startRename(menu.nodeId);
              }}
            >
              {t("重命名", "Rename")}
            </MenuItem>
            {menuNode.kind !== "root" && (
              <MenuItem
                danger
                onClick={() => {
                  setMenu(null);
                  if (
                    confirm(
                      t(
                        `删除「${menuNode.title}」及其下级？正文会移到回收站。`,
                        `Delete “${menuNode.title}” and its children? Content will be moved to the Recycle Bin.`,
                      ),
                    )
                  ) {
                    void deleteNode(menu.nodeId);
                  }
                }}
              >
                {t("删除节点", "Delete node")}
              </MenuItem>
            )}
          </div>
        </>
      )}
    </div>
  );
}

interface TreeProps {
  childrenOf: Map<string, Node[]>;
  selectedId: string | null;
  activeNodeId: string | null;
  generating: Record<string, boolean>;
  editing: { nodeId: string; value: string } | null;
  chapterCount: number;
  sectionCount: number;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  onMenu: (id: string, x: number, y: number) => void;
  onGenerate: (id: string) => void;
  onEditChange: (value: string) => void;
  onEditCommit: () => void;
  onEditCancel: () => void;
}

function Tree({ node, ...p }: { node: Node } & TreeProps) {
  const kids = p.childrenOf.get(node.id) ?? [];

  return (
    <div className="flex items-center">
      <NodeCard node={node} {...p} />
      {kids.length > 0 && (
        <>
          <span className="h-[1.5px] w-[22px] flex-none rounded-full bg-border" />
          {kids.length === 1 ? <Tree node={kids[0]} {...p} /> : <Rail nodes={kids} {...p} />}
        </>
      )}
    </div>
  );
}

/** 多子节点时的竖直脊线：用首末行中心点测量（preaxonote §4.5.2） */
function Rail({ nodes, ...p }: { nodes: Node[] } & TreeProps) {
  const railRef = useRef<HTMLDivElement>(null);
  const key = nodes.map((n) => n.id).join("|");
  const [geom, setGeom] = useState<{ height: number; centers: number[] }>({ height: 0, centers: [] });

  useLayoutEffect(() => {
    const railEl = railRef.current;
    if (!railEl) return;
    const measure = () => {
      // 只取本层级直接子行，避免把嵌套脊线的行算进来导致线段出头
      const rows = Array.from(railEl.children).filter(
        (el): el is HTMLElement => el instanceof HTMLElement && el.hasAttribute("data-rail-row"),
      );
      if (!rows.length) return;
      const rr = railEl.getBoundingClientRect();
      const centers = rows.map((row) => {
        const r = row.getBoundingClientRect();
        return Math.round((r.top + r.height / 2 - rr.top) * 10) / 10;
      });
      const height = Math.round(rr.height);
      setGeom((prev) =>
        prev.height === height &&
        prev.centers.length === centers.length &&
        prev.centers.every((c, i) => c === centers[i])
          ? prev
          : { height, centers },
      );
    };
    measure();
    const raf = requestAnimationFrame(measure);
    const ro = new ResizeObserver(measure);
    ro.observe(railEl);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [key]);

  const first = geom.centers[0] ?? 0;
  const last = geom.centers[geom.centers.length - 1] ?? 0;

  return (
    <div ref={railRef} className="relative flex flex-col gap-3.5 pl-5">
      {geom.centers.length > 0 && (
        <svg
          className="pointer-events-none absolute left-0 top-0 overflow-visible"
          width={22}
          height={Math.max(geom.height, 1)}
          aria-hidden
        >
          {geom.centers.length > 1 && (
            <path
              d={`M1 ${first} L1 ${last}`}
              fill="none"
              stroke="var(--ax-border)"
              strokeWidth={1.5}
              strokeLinecap="round"
            />
          )}
          {geom.centers.map((cy, i) => (
            <path
              key={i}
              d={i === 0 ? `M1 ${cy} L21 ${cy}` : `M1 ${cy - 6} Q1 ${cy} 7 ${cy} L21 ${cy}`}
              fill="none"
              stroke="var(--ax-border)"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
        </svg>
      )}
      {nodes.map((n) => (
        <div key={n.id} data-rail-row className="relative flex items-center">
          <Tree node={n} {...p} />
        </div>
      ))}
    </div>
  );
}

function NodeCard({ node, ...p }: { node: Node } & TreeProps) {
  const t = useT();
  const kids = p.childrenOf.get(node.id) ?? [];
  const isRoot = node.kind === "root";
  const isChapter = node.kind === "chapter";
  const doneKids = kids.filter((k) => k.status === "done").length;
  const done = isChapter ? kids.length > 0 && doneKids === kids.length : node.status === "done";
  const running = !!p.generating[node.id];
  const selected = p.selectedId === node.id;
  const active = p.activeNodeId === node.id;
  const edit = p.editing?.nodeId === node.id ? p.editing : null;

  const stateClass = active
    ? "border-accent bg-accent-soft"
    : selected
      ? "border-fg/60 ring-2 ring-fg/10"
      : "border-border bg-card hover:bg-surface";

  return (
    <div
      data-node-id={node.id}
      tabIndex={0}
      role="button"
      className={`group relative flex-none cursor-pointer rounded-[10px] border px-3.5 py-2.5 text-left outline-none shadow-sm transition-colors ${
        isRoot ? "w-[208px]" : "w-[224px]"
      } ${stateClass}`}
      style={
        isRoot ? { background: "linear-gradient(180deg, var(--ax-surface-2) 0%, var(--ax-card) 100%)" } : undefined
      }
      onClick={(e) => {
        e.stopPropagation();
        p.onSelect(node.id);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        p.onOpen(node.id);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        p.onMenu(node.id, e.clientX, e.clientY);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          p.onOpen(node.id);
        }
      }}
    >
      {edit ? (
        <input
          autoFocus
          className="ax-input h-7 w-full py-0 text-xs"
          value={edit.value}
          onChange={(e) => p.onEditChange(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") p.onEditCommit();
            else if (e.key === "Escape") p.onEditCancel();
          }}
          onBlur={() => p.onEditCommit()}
        />
      ) : (
        <>
          {isRoot && <div className="ax-eyebrow mb-1">{t("领域", "Domain")}</div>}
          <div
            className={`line-clamp-3 text-[13px] leading-snug ${
              isRoot ? "text-sm font-semibold" : isChapter ? "font-medium" : ""
            } ${done && !isRoot ? "text-[color:var(--ax-ok)]" : ""}`}
          >
            {node.title}
          </div>
          {!isRoot && node.goal && (
            <div className="mt-1 line-clamp-2 text-[10.5px] leading-snug text-ink3">{node.goal}</div>
          )}
          {isRoot && (
            <div className="mt-1 text-[10.5px] text-ink3">
              {t(`${p.chapterCount} 章 · ${p.sectionCount} 节`, `${p.chapterCount} chapters · ${p.sectionCount} sections`)}
            </div>
          )}
          {isChapter && (
            <div className="mt-1 text-[10px] text-ink3">
              {t(`${doneKids}/${kids.length} 节已生成`, `${doneKids}/${kids.length} sections generated`)}
            </div>
          )}
        </>
      )}

      {!isRoot && !edit && (
        <div className="mt-1.5 flex h-4 items-center gap-2 text-[10px]">
          {running ? (
            <span className="text-[color:var(--ax-accent)]">{t("生成中…", "Generating…")}</span>
          ) : done ? (
            <span className="text-[color:var(--ax-ok)]">{t("已生成", "Generated")}</span>
          ) : node.status === "failed" ? (
            <button
              className="text-[color:var(--ax-err)] hover:underline"
              onClick={(e) => {
                e.stopPropagation();
                p.onGenerate(node.id);
              }}
            >
              {t("失败 · 重试", "Failed · Retry")}
            </button>
          ) : node.kind === "section" ? (
            <button
              className="text-ink3 opacity-0 transition-opacity hover:text-fg group-hover:opacity-100 focus:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                p.onGenerate(node.id);
              }}
            >
              {t("生成", "Generate")}
            </button>
          ) : (
            <span />
          )}
        </div>
      )}
    </div>
  );
}

function MenuItem({
  children,
  danger,
  onClick,
}: {
  children: ReactNode;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`block w-full rounded px-2.5 py-1.5 text-left text-xs hover:bg-surface ${
        danger ? "text-[var(--ax-err)]" : ""
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="ax-dot" style={{ background: color }} />
      {label}
    </span>
  );
}
