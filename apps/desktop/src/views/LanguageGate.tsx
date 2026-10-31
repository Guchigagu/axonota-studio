import { useApp } from "../store";

/** 首次启动：先选语言，再进主界面；选完写进设置，之后可在设置里改 */
export function LanguageGate() {
  const setLanguage = useApp((s) => s.setLanguage);

  return (
    <div className="grid h-full place-items-center bg-bg px-6 text-fg">
      <div className="w-full max-w-[620px]">
        <div className="text-[10px] uppercase tracking-[0.22em] text-ink3">Axonota</div>
        <h1 className="mt-3 text-[26px] font-semibold tracking-tight">选择语言 · Choose your language</h1>
        <p className="mt-3 text-sm leading-relaxed text-mutedfg">
          界面与之后生成的笔记都会使用这个语言，可在设置里随时切换。
          <br />
          The interface and the notes Axonota writes will use this language. You can change it later in Settings.
        </p>
        <div className="mt-9 grid gap-3 sm:grid-cols-2">
          <button
            className="ax-panel flex flex-col items-start gap-1 p-5 text-left transition-colors hover:border-fg/40"
            onClick={() => void setLanguage("zh")}
          >
            <span className="text-base font-semibold">中文</span>
            <span className="text-xs text-mutedfg">简体中文界面与中文笔记</span>
          </button>
          <button
            className="ax-panel flex flex-col items-start gap-1 p-5 text-left transition-colors hover:border-fg/40"
            onClick={() => void setLanguage("en")}
          >
            <span className="text-base font-semibold">English</span>
            <span className="text-xs text-mutedfg">English interface and notes</span>
          </button>
        </div>
      </div>
    </div>
  );
}
