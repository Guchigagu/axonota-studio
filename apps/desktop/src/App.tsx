import { useEffect } from "react";
import { useApp } from "./store";
import { Home } from "./views/Home";
import { NotebookView } from "./views/NotebookView";
import { SettingsPage } from "./views/SettingsPage";
import { openRecycleBin } from "./lib/env";
import { LanguageGate } from "./views/LanguageGate";
import { useT } from "./i18n";

export function App() {
  const t = useT();
  const ready = useApp((s) => s.ready);
  const language = useApp((s) => s.settings.language);
  const screen = useApp((s) => s.screen);
  const error = useApp((s) => s.error);
  const theme = useApp((s) => s.settings.theme);
  const boot = useApp((s) => s.boot);
  const notice = useApp((s) => s.notice);
  const exportPath = useApp((s) => s.exportPath);
  const setNotice = useApp((s) => s.setNotice);
  const revealExport = useApp((s) => s.revealExport);
  const preview = useApp((s) => s.preview);
  const closePreview = useApp((s) => s.closePreview);

  useEffect(() => {
    void boot();
  }, [boot]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 8000);
    return () => clearTimeout(t);
  }, [notice, setNotice]);

  if (!ready) {
    return <div className="grid h-full place-items-center text-sm text-ink3">{t("正在打开本地数据…", "Opening local data…")}</div>;
  }

  // 首次启动必须先选语言；选完写进设置，后续从设置里改
  if (!language) return <LanguageGate />;

  return (
    <div className="flex h-full flex-col bg-bg text-fg">
      {error && (
        <div className="border-b border-[var(--ax-err-line)] bg-[var(--ax-err-soft)] px-4 py-2 text-xs text-[var(--ax-err)]">
          {error}
        </div>
      )}
      {screen.name === "home" && <Home />}
      {screen.name === "notebook" && <NotebookView />}
      {screen.name === "settings" && <SettingsPage />}
      {preview && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-6"
          onClick={closePreview}
        >
          <div
            className="ax-panel flex max-h-[86vh] w-full max-w-[820px] flex-col p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between gap-3">
              <h2 className="truncate text-[14px] font-semibold">{preview.name}</h2>
              <button className="ax-icon-btn shrink-0" title={t("关闭预览", "Close preview")} onClick={closePreview}>
                ×
              </button>
            </div>
            {preview.kind === "image" ? (
              <img
                src={preview.url}
                alt={preview.name}
                className="mx-auto max-h-[72vh] w-auto max-w-full object-contain"
              />
            ) : (
              <pre className="ax-scroll max-h-[72vh] overflow-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-ink2">
                {preview.text || t("（空文件）", "(empty file)")}
              </pre>
            )}
          </div>
        </div>
      )}
      {notice && (
        <div className="pointer-events-none fixed inset-x-0 bottom-5 z-[80] flex justify-center px-4">
          <div className="pointer-events-auto flex max-w-[560px] items-center gap-3 rounded-lg border border-border bg-surface2 px-3.5 py-2.5 text-xs text-mutedfg shadow-lg">
            <span className="min-w-0 flex-1 leading-relaxed">{notice}</span>
            {exportPath && (
              <button className="ax-link shrink-0" onClick={revealExport}>
                {t("打开文件夹", "Open folder")}
              </button>
            )}
            {!exportPath && (notice.includes("回收站") || notice.includes("Recycle Bin")) && (
              <button className="ax-link shrink-0" onClick={openRecycleBin}>
                {t("打开回收站", "Open Recycle Bin")}
              </button>
            )}
            <button className="ax-icon-btn shrink-0" title={t("关闭提示", "Dismiss")} onClick={() => setNotice(null)}>
              ×
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
