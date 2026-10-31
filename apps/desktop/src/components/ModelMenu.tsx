import { useEffect, useRef, useState } from "react";
import type { ModelConfig } from "@nb/core";
import { useT } from "../i18n";

interface Props {
  models: ModelConfig[];
  value: string;
  onSelect: (id: string) => void;
  onManage: () => void;
  /** composer: 对话框内的小尺寸触发按钮；inline: 页面里的文字按钮 */
  variant?: "composer" | "inline";
  align?: "left" | "right";
  title?: string;
}

/** 模型选择小菜单：点开就地弹出，不跳页；选中项打勾，底部固定「添加模型」入口 */
export function ModelMenu({
  models,
  value,
  onSelect,
  onManage,
  variant = "composer",
  align = "right",
  title,
}: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = models.find((m) => m.id === value);
  const label = title ?? t("切换模型", "Switch model");

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as HTMLElement)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative inline-flex min-w-0">
      <button
        className={
          variant === "composer"
            ? "flex h-7 max-w-[100px] items-center gap-1 rounded-[6px] px-1.5 text-[10px] text-mutedfg hover:bg-surface hover:text-fg"
            : "flex items-center gap-1 text-[12px] text-mutedfg hover:text-fg"
        }
        title={label}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="min-w-0 truncate">{current?.name ?? t("尚未配置模型", "No model configured")}</span>
        <svg
          width="9"
          height="9"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path d="M6 15l6-6 6 6" />
        </svg>
      </button>

      {open && (
        <div
          className={`ax-panel-float absolute bottom-full z-40 mb-1.5 w-[252px] p-1 ${
            align === "right" ? "right-0" : "left-0"
          }`}
          role="menu"
        >
          <div className="ax-scroll max-h-[264px] overflow-y-auto">
            {models.length === 0 && (
              <div className="px-2.5 py-3 text-[11px] leading-relaxed text-ink3">
                {t(
                  "还没有添加模型。先点下面的「添加模型」填服务商地址与 Key。",
                  "No models yet. Use \"Add model\" below to enter the provider URL and key.",
                )}
              </div>
            )}
            {models.map((m) => {
              const selected = m.id === value;
              return (
                <button
                  key={m.id}
                  role="menuitemradio"
                  aria-checked={selected}
                  className="flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left hover:bg-surface"
                  onClick={() => {
                    onSelect(m.id);
                    setOpen(false);
                  }}
                >
                  <span className="grid h-4 w-4 shrink-0 place-items-center rounded-[3px] bg-surface2 text-[9px] font-semibold text-mutedfg">
                    {m.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-fg">{m.name}</span>
                  <span className="max-w-[92px] shrink-0 truncate text-[10px] text-ink3" title={m.modelId}>
                    {m.modelId}
                  </span>
                  <span className="grid w-3 shrink-0 place-items-center text-accent">
                    {selected && (
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M4 12.5l5 5L20 6.5" />
                      </svg>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="mx-1 my-1 h-px bg-border" />
          <button
            className="flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-[11px] text-mutedfg hover:bg-surface hover:text-fg"
            onClick={() => {
              setOpen(false);
              onManage();
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
              <path d="M12 5v14M5 12h14" />
            </svg>
            {t("添加模型", "Add model")}
          </button>
        </div>
      )}
    </div>
  );
}
