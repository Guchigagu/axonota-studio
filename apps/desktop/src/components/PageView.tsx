import { useMemo, useState } from "react";
import type { Node } from "@nb/core";
import { useApp } from "../store";
import { useT } from "../i18n";
import { Markdown } from "./Markdown";

interface FlashcardItem {
  id: string;
  front: string;
  back: string;
  example?: string;
  tag?: string;
}

interface GlossaryItem {
  id: string;
  kind: "term" | "formula";
  term: string;
  en?: string;
  formula?: string;
  definition: string;
  sectionRef?: string;
}

/** 组件页：正文是 JSON，按 pageKind 渲染成可操作的页面（不是纯文本） */
export function PageView({ node }: { node: Node }) {
  const t = useT();
  const bodies = useApp((s) => s.bodies);
  const raw = bodies[node.id] ?? "";

  const data = useMemo(() => {
    if (!raw.trim()) return null;
    try {
      return JSON.parse(raw) as {
        title?: string;
        summary?: string;
        items?: unknown[];
      };
    } catch {
      return null;
    }
  }, [raw]);

  if (!raw.trim()) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-mutedfg">
        {node.status === "failed"
          ? t("生成失败，回到本节点「重新生成」。", "Generation failed. Use Regenerate on this node.")
          : t("正在生成组件…", "Generating component…")}
      </div>
    );
  }

  if (!data || !Array.isArray(data.items)) {
    return (
      <div className="mx-auto w-full max-w-[720px] px-6 py-8">
        <div className="mb-3 text-[11px] text-ink3">
          {t("组件数据无法解析，下面是原始内容", "Couldn't parse the component data; raw content below")}
        </div>
        <Markdown text={raw} />
      </div>
    );
  }

  const items = data.items;
  if (node.pageKind === "flashcards") {
    return <Flashcards items={items as FlashcardItem[]} />;
  }
  if (node.pageKind === "glossary") {
    return <Glossary items={items as GlossaryItem[]} summary={data.summary} />;
  }
  return (
    <div className="mx-auto w-full max-w-[720px] px-6 py-8">
      <Markdown text={raw} />
    </div>
  );
}

function Pdf({ children }: { children: React.ReactNode }) {
  return <div className="text-[13px] leading-relaxed [&_p]:m-0">{children}</div>;
}

function Flashcards({ items }: { items: FlashcardItem[] }) {
  const t = useT();
  const [flipped, setFlipped] = useState<Record<string, boolean>>({});
  return (
    <div className="mx-auto w-full max-w-[820px] px-6 py-8">
      <div className="mb-4 flex items-center gap-2">
        <span className="ax-eyebrow">{t(`闪卡 ${items.length} 张`, `${items.length} flashcards`)}</span>
        <span className="text-[11px] text-ink3">
          {t("点卡片翻面，先自己答再翻", "Tap a card to flip — answer it yourself first")}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {items.map((it) => {
          const open = !!flipped[it.id];
          return (
            <button
              key={it.id}
              className="ax-panel min-h-[132px] p-4 text-left transition-colors hover:bg-surface"
              onClick={() => setFlipped((f) => ({ ...f, [it.id]: !open }))}
            >
              <div className="mb-2 flex items-center gap-2">
                <span className="ax-badge">{open ? t("答案", "Answer") : t("问题", "Question")}</span>
                {it.tag && <span className="text-[10px] text-ink3">{it.tag}</span>}
              </div>
              <div className="text-[13px] leading-relaxed">
                <Pdf>
                  <Markdown text={open ? it.back : it.front} />
                </Pdf>
                {open && it.example && (
                  <div className="mt-2 border-l-2 border-border pl-2 text-[11px] text-mutedfg">{it.example}</div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Glossary({ items, summary }: { items: GlossaryItem[]; summary?: string }) {
  const t = useT();
  const [bucket, setBucket] = useState<"all" | "af" | "gp" | "rz">("all");
  const [query, setQuery] = useState("");
  const [alpha, setAlpha] = useState(false);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = items.filter((it) => {
      if (bucket !== "all") {
        const key = (it.en?.trim() || it.term.trim()).charAt(0).toUpperCase();
        const inBucket =
          bucket === "af"
            ? key >= "A" && key <= "F"
            : bucket === "gp"
              ? key >= "G" && key <= "P"
              : key >= "R" && key <= "Z";
        if (!inBucket) return false;
      }
      if (!q) return true;
      return [it.term, it.en ?? "", it.definition, it.formula ?? "", it.sectionRef ?? ""].some((v) =>
        v.toLowerCase().includes(q),
      );
    });
    if (alpha) filtered.sort((a, b) => (a.en ?? a.term).localeCompare(b.en ?? b.term, "en"));
    return filtered;
  }, [items, bucket, query, alpha]);

  return (
    <div className="mx-auto w-full max-w-[760px] px-6 py-8">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="ax-eyebrow">{t("术语与公式速查", "Terms & formulas")}</p>
          <p className="ax-caption mt-1">
            {t(`共 ${items.length} 条 · 当前 ${shown.length} 条`, `${items.length} entries · showing ${shown.length}`)}
          </p>
        </div>
        <button className="ax-btn ax-btn-ghost h-8 text-[12px]" onClick={() => setAlpha((v) => !v)}>
          {alpha ? t("按生成顺序", "Generation order") : t("按字母重排", "Sort A–Z")}
        </button>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5">
          {(
            [
              { id: "all", label: ["全部", "All"] as [string, string] },
              { id: "af", label: ["A–F", "A–F"] as [string, string] },
              { id: "gp", label: ["G–P", "G–P"] as [string, string] },
              { id: "rz", label: ["R–Z", "R–Z"] as [string, string] },
            ] as const
          ).map((b) => (
            <button
              key={b.id}
              className={`ax-chip ${bucket === b.id ? "ax-chip-active" : ""}`}
              onClick={() => setBucket(b.id)}
            >
              {t(b.label[0], b.label[1])}
            </button>
          ))}
        </div>
        <input
          className="ax-input ml-auto h-8 w-[220px] text-[12px]"
          placeholder={t("搜索术语、英文或解释", "Search terms, English, or definitions")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="ax-panel mt-4 overflow-hidden">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="bg-muted text-left">
              <th className="w-[130px] px-4 py-2.5 text-[11px] font-medium text-mutedfg">{t("术语", "Term")}</th>
              <th className="w-[120px] px-3 py-2.5 text-[11px] font-medium text-mutedfg">{t("英文", "English")}</th>
              <th className="px-3 py-2.5 text-[11px] font-medium text-mutedfg">{t("一句话解释", "Definition")}</th>
              <th className="w-[168px] px-3 py-2.5 text-[11px] font-medium text-mutedfg">{t("公式 / 记法", "Formula / notation")}</th>
              <th className="w-[92px] px-3 py-2.5 text-[11px] font-medium text-mutedfg">{t("所在页", "Section")}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((it) => (
              <tr key={it.id} className="border-t border-border align-top hover:bg-surface">
                <td className="px-4 py-3 font-medium">{it.term}</td>
                <td className="px-3 py-3 text-mutedfg">{it.en ?? "—"}</td>
                <td className="px-3 py-3 leading-relaxed text-ink2">{it.definition}</td>
                <td className="px-3 py-3">
                  {it.formula ? (
                    <Pdf>
                      <Markdown text={`$${it.formula}$`} />
                    </Pdf>
                  ) : (
                    <span className="text-ink3">—</span>
                  )}
                </td>
                <td className="px-3 py-3 text-[12px]">
                  {it.sectionRef ? <span className="ax-link">{it.sectionRef}</span> : <span className="text-ink3">—</span>}
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-[12px] text-ink3">
                  {t("没有匹配的条目，换个关键词或字母分组试试。", "No matches. Try another keyword or letter group.")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="ax-caption">{t("公式使用衬线斜体排版，随导出保留。", "Formulas use serif italics and are kept in exports.")}</p>
        <p className="ax-caption truncate">{summary ? t(`来源：${summary}`, `Source: ${summary}`) : ""}</p>
      </div>
    </div>
  );
}
