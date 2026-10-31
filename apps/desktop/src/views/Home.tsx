import { useMemo, useRef, useState } from "react";
import { parseOutlineText, STYLE_PRESETS } from "@nb/core";
import { useApp, type NewNotebookInput } from "../store";
import { useT } from "../i18n";
import { ModelMenu } from "../components/ModelMenu";
import { openRecycleBin } from "../lib/env";
import { PRESET_EN } from "../lib/lang";

export function Home() {
  const t = useT();
  const notebooks = useApp((s) => s.notebooks);
  const startOutline = useApp((s) => s.startOutline);
  const outlineDraft = useApp((s) => s.outlineDraft);
  const outlineText = useApp((s) => s.outlineText);
  const outlineBusy = useApp((s) => s.outlineBusy);
  const outlineAdjusting = useApp((s) => s.outlineAdjusting);
  const outlineConfirming = useApp((s) => s.outlineConfirming);
  const outlineError = useApp((s) => s.outlineError);
  const setOutlineText = useApp((s) => s.setOutlineText);
  const refineOutline = useApp((s) => s.refineOutline);
  const commitOutline = useApp((s) => s.commitOutline);
  const closeOutline = useApp((s) => s.closeOutline);
  const openNotebook = useApp((s) => s.openNotebook);
  const openSettings = useApp((s) => s.openSettings);
  const deleteNotebook = useApp((s) => s.deleteNotebook);
  const setNotebookColor = useApp((s) => s.setNotebookColor);
  const seedDemoNotebook = useApp((s) => s.seedDemoNotebook);
  const importArchive = useApp((s) => s.importArchive);
  const settings = useApp((s) => s.settings);
  const error = useApp((s) => s.error);
  const toggleWebSearch = useApp((s) => s.toggleWebSearch);
  const setDefaultModel = useApp((s) => s.setDefaultModel);

  const [pane, setPane] = useState<"home" | "all">("home");
  const [searchOpen, setSearchOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [topic, setTopic] = useState("");
  const [requirement, setRequirement] = useState("");
  const [style, setStyle] = useState("feynman");
  const [rootFile, setRootFile] = useState<{ name: string; text: string } | null>(null);
  const [showStyle, setShowStyle] = useState(false);
  const [adjust, setAdjust] = useState("");
  const [colorTarget, setColorTarget] = useState<{ id: string; title: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const zipRef = useRef<HTMLInputElement>(null);
  const topicRef = useRef<HTMLTextAreaElement>(null);

  const ready = settings.models.length > 0;
  const model = settings.models.find((m) => m.id === settings.defaultModelId) ?? settings.models[0];
  const edited = useMemo(() => parseOutlineText(outlineText), [outlineText]);
  const colorSelected = colorTarget ? notebooks.find((n) => n.id === colorTarget.id)?.color : undefined;
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return notebooks;
    return notebooks.filter((n) => n.title.toLowerCase().includes(q) || n.topic.toLowerCase().includes(q));
  }, [notebooks, query]);

  async function submit() {
    if (!topic.trim() || outlineBusy) return;
    const input: NewNotebookInput = { topic, requirement, style, rootText: rootFile ?? undefined };
    await startOutline(input);
  }

  async function regenerateOutline() {
    if (outlineAdjusting || !adjust.trim()) return;
    const requirement = adjust.trim();
    await refineOutline(requirement);
    setAdjust("");
  }

  return (
    <div className="flex h-full">
      <aside className="flex w-[248px] shrink-0 flex-col border-r border-border">
        <div className="flex h-12 items-center border-b border-border px-4">
          <span className="text-[15px] font-semibold tracking-[-0.02em]">axonota</span>
        </div>

        <div className="p-3">
          <button
            className="ax-btn ax-btn-primary w-full"
            onClick={() => {
              setPane("home");
              topicRef.current?.focus();
            }}
          >
            {t("＋ 新建笔记本", "＋ New notebook")}
          </button>
        </div>

        <nav className="space-y-0.5 px-2">
          <button
            className={`ax-tree-row w-full text-left ${pane === "home" ? "is-active" : ""}`}
            onClick={() => setPane("home")}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="7" rx="1.5" />
              <rect x="14" y="3" width="7" height="7" rx="1.5" />
              <rect x="3" y="14" width="7" height="7" rx="1.5" />
              <rect x="14" y="14" width="7" height="7" rx="1.5" />
            </svg>
            <span className="flex-1">{t("工作台", "Workspace")}</span>
          </button>
          <button
            className={`ax-tree-row w-full text-left ${pane === "all" ? "is-active" : ""}`}
            onClick={() => setPane("all")}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 6.5A3.5 3.5 0 0 1 7.5 3H20v18H7.5A3.5 3.5 0 0 1 4 17.5z" />
              <path d="M9 8h7M9 12h5" />
            </svg>
            <span className="flex-1">{t("全部笔记本", "All notebooks")}</span>
          </button>
          <button className="ax-tree-row w-full text-left" onClick={openSettings}>
            <GearIcon size={15} />
            <span className="flex-1">{t("设置", "Settings")}</span>
          </button>
        </nav>

        <div className="mt-auto border-t border-border p-4">
          <p className="text-[11px] leading-relaxed text-mutedfg">
            {t(
              "数据存在本机。生成与对话时，内容按需发送给模型服务。",
              "Data stays on this device. During generation and chat, content is sent to the model service as needed.",
            )}
          </p>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="relative flex h-12 items-center justify-end gap-1 border-b border-border px-5">
          <button
            className={`ax-icon-btn ${searchOpen ? "bg-surface2 text-fg" : ""}`}
            title={t("搜索笔记本", "Search notebooks")}
            aria-label={t("搜索笔记本", "Search notebooks")}
            onClick={() => {
              setSearchOpen((v) => !v);
              setQuery("");
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" />
            </svg>
          </button>
          <button
            className={`ax-icon-btn ${helpOpen ? "bg-surface2 text-fg" : ""}`}
            title={t("使用提示", "Tips")}
            aria-label={t("使用提示", "Tips")}
            onClick={() => setHelpOpen((v) => !v)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <circle cx="12" cy="12" r="9" />
              <path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.7" />
              <path d="M12 17h.01" />
            </svg>
          </button>
          <button
            className="ax-icon-btn ml-2"
            title={t("打开设置", "Open settings")}
            aria-label={t("打开设置", "Open settings")}
            onClick={openSettings}
          >
            <GearIcon size={16} />
          </button>
          {helpOpen && (
            <div className="ax-panel-float absolute right-5 top-12 z-20 w-[300px] p-3 text-[12px] leading-relaxed text-mutedfg">
              <div className="mb-1 font-medium text-fg">{t("三步用起来", "Get started in three steps")}</div>
              <ol className="list-decimal space-y-1 pl-4">
                <li>{t("写清主题与时限，点 ↑ 先出大纲。", "Write a clear topic and deadline, then press ↑ to draft an outline.")}</li>
                <li>
                  {t(
                    "大纲弹窗里可直接改章节；不满意就写调整要求重出。",
                    "Edit chapters right in the outline dialog; if it's off, describe the changes and regenerate.",
                  )}
                </li>
                <li>
                  {t(
                    "确认后逐节生成，思维导图里点节点就能读正文。",
                    "After confirming, sections generate one by one; click a node in the mind map to read it.",
                  )}
                </li>
              </ol>
            </div>
          )}
        </div>

        <div className="ax-scroll flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[760px] px-8 pb-20 pt-16">
            {pane === "home" ? (
              <>
                <p className="ax-eyebrow">{t("工作台", "Workspace")}</p>
                <h1 className="ax-h1 mt-3">{t("今天想把哪个领域装进脑子？", "What do you want to master today?")}</h1>
                <p className="ax-caption mt-3">
                  {t(
                    "三周、三天、明天考 —— 都可以。先给主题，再加要求。",
                    "Three weeks, three days, or an exam tomorrow — all work. Give us the topic first, then add requirements.",
                  )}
                </p>
              </>
            ) : (
              <>
                <p className="ax-eyebrow">{t("全部笔记本", "All notebooks")}</p>
                <h1 className="ax-h1 mt-3">{t("全部笔记本", "All notebooks")}</h1>
                <p className="ax-caption mt-3">
                  {t(
                    "按最近打开排序。点标题打开，点左上角头像可换配色。",
                    "Sorted by recently opened. Click a title to open; click the avatar to change its color.",
                  )}
                </p>
              </>
            )}

            {pane === "home" && (
              <>
                <div className="ax-panel mt-7 overflow-hidden">
                  <div className="p-4 pb-2">
                    <textarea
                      ref={topicRef}
                      rows={3}
                      className="w-full resize-none bg-transparent text-[14px] leading-relaxed outline-none placeholder:text-ink3"
                      placeholder={t(
                        "输入学习主题，例如：三周内吃透线性代数，课后题能自己做",
                        "Enter a learning topic, e.g. master linear algebra in three weeks and solve the exercises yourself",
                      )}
                      value={topic}
                      onChange={(e) => setTopic(e.target.value)}
                    />
                    <input
                      className="mt-1 w-full bg-transparent text-[12px] outline-none placeholder:text-ink3"
                      placeholder={t(
                        "特殊要求（时限、用途、要交付什么，可留空）",
                        "Extra requirements (deadline, purpose, deliverables — optional)",
                      )}
                      value={requirement}
                      onChange={(e) => setRequirement(e.target.value)}
                    />
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {STYLE_CHIPS.map((c) => {
                        const preset = STYLE_PRESETS.find((s) => s.id === c.id);
                        return (
                          <button
                            key={c.id}
                            className={`ax-chip ${style === c.id ? "ax-chip-active" : ""}`}
                            title={
                              preset
                                ? t(preset.description, PRESET_EN[preset.id]?.desc ?? preset.description)
                                : undefined
                            }
                            onClick={() => {
                              setStyle(c.id);
                              setShowStyle(false);
                            }}
                          >
                            {t(c.label.zh, c.label.en)}
                          </button>
                        );
                      })}
                      <button
                        className={`ax-chip ${style.startsWith("custom:") || showStyle ? "ax-chip-active" : ""}`}
                        title={t("自定义讲法：一句话描述风格", "Custom style: describe it in one sentence")}
                        onClick={() => setShowStyle((v) => !v)}
                      >
                        {t("自定义风格", "Custom style")}
                      </button>
                    </div>
                    {showStyle && (
                      <div className="mt-2 border-t border-border pt-2">
                        <div className="mb-1 px-1 text-[11px] font-medium text-mutedfg">
                          {t("讲解风格（决定大纲与正文的讲法）", "Explanation style (shapes the outline and the body)")}
                        </div>
                        <div className="grid gap-0.5 sm:grid-cols-2">
                          {STYLE_PRESETS.map((p) => (
                            <button
                              key={p.id}
                              className={`rounded-md px-2 py-1.5 text-left ${style === p.id ? "bg-surface2" : "hover:bg-surface"}`}
                              onClick={() => setStyle(p.id)}
                            >
                              <div className="flex items-center gap-1.5 text-xs font-medium">
                                <span className="w-3 text-[10px]">{style === p.id ? "✓" : ""}</span>
                                {t(p.name, PRESET_EN[p.id]?.name ?? p.name)}
                              </div>
                              <div className="mt-0.5 pl-[18px] text-[11px] leading-snug text-ink3">
                                {t(p.description, PRESET_EN[p.id]?.desc ?? p.description)}
                              </div>
                            </button>
                          ))}
                        </div>
                        <div className="mt-1.5 border-t border-border pt-2">
                          <div className="flex gap-1.5">
                            <input
                              className="ax-input h-7 flex-1 py-0 text-xs"
                              placeholder={t("自定义：一句话描述讲法", "Custom: describe the style in one sentence")}
                              value={style.startsWith("custom:") ? style.slice(7) : ""}
                              onChange={(e) => setStyle(`custom:${e.target.value}`)}
                            />
                            {style.startsWith("custom:") && style.length > 7 && (
                              <span className="self-center text-[10px] text-ink3">{t("已启用自定义", "Custom enabled")}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <button
                        className="ax-btn ax-btn-ghost h-7 px-2 text-[12px]"
                        onClick={() => fileRef.current?.click()}
                        title={t("整本笔记本的参考资料", "Reference material for the whole notebook")}
                      >
                        {t("＋ 参考资料", "＋ Reference")}
                        {rootFile && <span className="max-w-[130px] truncate">· {rootFile.name}</span>}
                      </button>
                      <input
                        ref={fileRef}
                        type="file"
                        className="hidden"
                        accept=".md,.txt,.csv,.json,.yml,.yaml,.html"
                        onChange={async (e) => {
                          const f = e.target.files?.[0];
                          if (!f) return;
                          const text = await f.text();
                          setRootFile({ name: f.name, text });
                          e.target.value = "";
                        }}
                      />
                      <button
                        className="ax-btn ax-btn-ghost h-7 px-2 text-[12px]"
                        onClick={() => void toggleWebSearch()}
                        title={t("联网检索开关", "Web search toggle")}
                      >
                        {t("联网检索", "Web search")}
                        <span className={`ax-badge ${settings.webSearch ? "ax-badge-done" : ""}`}>
                          {settings.webSearch ? t("开启", "On") : t("关闭", "Off")}
                        </span>
                      </button>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <ModelMenu
                        models={settings.models}
                        value={model?.id ?? ""}
                        onSelect={(id) => void setDefaultModel(id)}
                        onManage={openSettings}
                        variant="inline"
                        title={t("切换默认模型（就地切换，不离开工作台）", "Switch default model (in place, without leaving the workspace)")}
                      />
                      <button
                        className="grid h-8 w-8 place-items-center rounded-full bg-fg text-bg disabled:opacity-40"
                        onClick={() => void submit()}
                        disabled={!ready || !topic.trim() || outlineBusy}
                        title={ready ? t("生成大纲", "Generate outline") : t("先到设置里添加一个模型", "Add a model in Settings first")}
                        aria-label={t("生成大纲", "Generate outline")}
                      >
                        {outlineBusy ? <span className="text-[13px]">…</span> : <span className="text-[15px] leading-none">↑</span>}
                      </button>
                    </div>
                  </div>
                  {outlineBusy && (
                    <div className="flex items-center gap-2 border-t border-border px-4 py-2 text-[11px] text-ink3">
                      <span className="ax-spinner" />
                      {t("正在生成大纲，先收敛范围再列章节…", "Generating outline — narrowing scope before listing chapters…")}
                    </div>
                  )}
                </div>
                <p className="ax-caption mt-2.5">
                  {t("先出大纲，确认后再生成整本。", "Generate the outline first; build the full notebook after you confirm.")}
                </p>
                {!ready && (
                  <p className="ax-caption mt-1">
                    {t("还没添加模型，", "No model added yet. ")}
                    <button className="ax-link" onClick={openSettings}>
                      {t("去设置里填服务商地址与 Key", "Add the provider URL and key in Settings")}
                    </button>
                    {t("。", ".")}
                  </p>
                )}
              </>
            )}

          {!outlineDraft && (outlineError || error) && (
            <div className="mt-3 text-xs text-[var(--ax-err)]">{outlineError ?? error}</div>
          )}

            <div className="mt-12">
              <div className="flex items-center justify-between gap-3">
                <h2 className="ax-h3">{pane === "home" ? t("我的笔记本", "My notebooks") : t("全部", "All")}</h2>
                <div className="flex items-center gap-2">
                  {searchOpen && (
                    <input
                      autoFocus
                      className="ax-input h-7 w-[180px] py-0 text-[12px]"
                      placeholder={t("搜索标题或主题…", "Search title or topic…")}
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  )}
                  <span className="ax-caption">
                    {t(`${shown.length} 本 · 按最近打开排序`, `${shown.length} notebooks · sorted by recently opened`)}
                  </span>
                  <button
                    className="ax-chip"
                    title={t(
                      "从导出的 zip 归档恢复一整本笔记本（含结构、正文、对话）",
                      "Restore a full notebook from an exported zip archive (structure, content, chat)",
                    )}
                    onClick={() => zipRef.current?.click()}
                  >
                    {t("＋ 导入 zip", "＋ Import zip")}
                  </button>
                  <input
                    ref={zipRef}
                    type="file"
                    accept=".zip"
                    className="hidden"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      await importArchive(f);
                      e.target.value = "";
                    }}
                  />
                  <button
                    className="ax-chip"
                    title={t(
                      "打开系统回收站，恢复被删除的笔记本文件夹",
                      "Open the system recycle bin to restore deleted notebook folders",
                    )}
                    onClick={openRecycleBin}
                  >
                    {t("回收站", "Recycle bin")}
                  </button>
                  {!ready && notebooks.length > 0 && (
                    <button className="ax-chip" onClick={() => void seedDemoNotebook()}>
                      {t("重建离线示例", "Rebuild offline demo")}
                    </button>
                  )}
                </div>
              </div>

              {shown.length === 0 ? (
                <div className="ax-panel mt-3 grid place-items-center px-6 py-14 text-center">
                  <p className="text-sm text-mutedfg">
                    {notebooks.length === 0
                      ? t(
                          "还没有笔记本。把主题填进上面的框里，先得到一份大纲。",
                          "No notebooks yet. Enter a topic above to get an outline.",
                        )
                      : t("没有匹配的笔记本，换个关键词试试。", "No matching notebooks. Try another keyword.")}
                  </p>
                </div>
              ) : (
                <div className="ax-panel mt-3 divide-y divide-border overflow-hidden">
                  {shown.map((n) => {
                    const pct = n.nodeCount ? Math.round((n.doneCount / n.nodeCount) * 100) : 0;
                    const badge =
                      n.nodeCount === 0
                        ? { label: t("只有结构", "Outline only"), cls: "ax-badge" }
                        : n.doneCount >= n.nodeCount
                          ? { label: t("已生成", "Generated"), cls: "ax-badge ax-badge-done" }
                          : { label: t("部分生成", "Partly generated"), cls: "ax-badge ax-badge-run" };
                    return (
                      <div
                        key={n.id}
                        className="group flex cursor-pointer items-center gap-3 px-4 py-3.5 hover:bg-muted"
                        onClick={() => void openNotebook(n.id)}
                      >
                        <button
                          type="button"
                          className="h-8 w-8 shrink-0 rounded-[8px]"
                          style={{ backgroundImage: gradientOf(n.color) }}
                          title={t("点击切换头像配色", "Click to change avatar color")}
                          onClick={(e) => {
                            e.stopPropagation();
                            setColorTarget({ id: n.id, title: n.title });
                          }}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-[13px] font-medium">{n.title}</span>
                            <span className={badge.cls}>{badge.label}</span>
                          </div>
                          <div className="mt-1 flex items-center gap-2">
                            <div className="ax-progress w-[104px]">
                              <div className="ax-progress-fill" style={{ width: `${pct}%` }} />
                            </div>
                            <span className="ax-caption">
                              {n.nodeCount
                                ? t(`${n.doneCount} / ${n.nodeCount} 节`, `${n.doneCount} / ${n.nodeCount} sections`)
                                : t("尚未生成正文", "No content yet")}
                            </span>
                          </div>
                        </div>
                        <span className="ax-caption shrink-0">{relTime(n.updatedAt, t)}</span>
                        <button
                          className="ax-icon-btn opacity-0 group-hover:opacity-100"
                          title={t("删除（移入系统回收站）", "Delete (move to system recycle bin)")}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (
                              confirm(
                                t(
                                  `删除《${n.title}》？将移入系统回收站，可从回收站恢复。`,
                                  `Delete “${n.title}”? It will be moved to the system recycle bin and can be restored from there.`,
                                ),
                              )
                            ) {
                              void deleteNotebook(n.id);
                            }
                          }}
                        >
                          ×
                        </button>
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.7"
                          strokeLinecap="round"
                          className="shrink-0 text-ink3"
                        >
                          <path d="M9 6l6 6-6 6" />
                        </svg>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="mt-6 flex flex-wrap items-center gap-2">
                <span className="ax-caption mr-1">{t("不知道学什么？试试", "Not sure what to learn? Try")}</span>
                {TOPIC_SUGGESTIONS.map((s) => (
                  <button
                    key={s.zh}
                    className="ax-chip"
                    onClick={() => {
                      setTopic(t(s.zh, s.en));
                      setPane("home");
                      topicRef.current?.focus();
                    }}
                  >
                    {t(s.zh, s.en)}
                  </button>
                ))}
                {!ready && (
                  <button className="ax-chip" onClick={() => void seedDemoNotebook()}>
                    {t("没有模型？先看一个离线示例", "No model? See an offline demo")}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>

      {outlineDraft && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-6"
          onClick={() => {
            if (!outlineConfirming && !outlineAdjusting) closeOutline();
          }}
        >
          <div
            className="ax-panel flex max-h-[88vh] w-full max-w-[720px] flex-col p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-[15px] font-semibold">{t("大纲（可编辑）", "Outline (editable)")}</h2>
                <p className="mt-1 text-[11px] text-mutedfg">
                  {t(
                    "确认后才生成思维导图与章节结构；这一步不会调用正文生成。",
                    "The mind map and chapter structure are created only after you confirm; this step doesn't generate any content.",
                  )}
                </p>
              </div>
              <button
                className="ax-icon-btn"
                title={t("关闭", "Close")}
                onClick={() => !outlineConfirming && !outlineAdjusting && closeOutline()}
              >
                ×
              </button>
            </div>
            {(outlineDraft.scope_one_line || outlineDraft.assumption) && (
              <div className="mb-3 rounded-md bg-surface px-3 py-2 text-[11px] leading-relaxed text-mutedfg">
                {outlineDraft.scope_one_line && (
                  <div>
                    {t("范围：", "Scope: ")}
                    {outlineDraft.scope_one_line}
                  </div>
                )}
                {outlineDraft.assumption && (
                  <div>
                    {t("收敛依据：", "Based on: ")}
                    {outlineDraft.assumption}
                  </div>
                )}
              </div>
            )}
            <label className="mb-1 block text-[11px] text-mutedfg" htmlFor="outline-text">
              {t("大纲", "Outline")}
            </label>
            <textarea
              id="outline-text"
              className="ax-input h-[340px] min-h-[200px] w-full resize-y text-[13px] leading-relaxed"
              value={outlineText}
              onChange={(e) => setOutlineText(e.target.value)}
              disabled={outlineAdjusting}
              spellCheck={false}
            />
            <div className="mt-1.5 flex items-center gap-2 text-[11px] text-ink3">
              <span>
                {t(
                  "每行一章；小节缩进两格；章名后可写“—— 学完能做到什么”。",
                  "One chapter per line; indent sections by two spaces; after a chapter name you can add “— what you'll be able to do”.",
                )}
              </span>
              <span className="ml-auto">
                {t(`${edited.chapters.length} 章`, `${edited.chapters.length} chapters`)} ·{" "}
                {t(
                  `${edited.chapters.reduce((n, c) => n + c.sections.length, 0)} 节`,
                  `${edited.chapters.reduce((n, c) => n + c.sections.length, 0)} sections`,
                )}
              </span>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <input
                className="ax-input h-8 flex-1 text-xs"
                placeholder={t(
                  "不满意就写调整要求，例如：第 2 章拆细、去掉第 4 章",
                  "Not happy? Describe the changes, e.g. split chapter 2, drop chapter 4",
                )}
                value={adjust}
                disabled={outlineAdjusting}
                onChange={(e) => setAdjust(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") void regenerateOutline();
                }}
              />
              <button
                className="ax-btn"
                disabled={!adjust.trim() || outlineAdjusting || outlineConfirming}
                onClick={() => void regenerateOutline()}
              >
                {outlineAdjusting ? t("重出中…", "Regenerating…") : t("按说明重出", "Regenerate")}
              </button>
            </div>
            <p className="mt-1 text-[10px] text-ink3">
              {t(
                "重出会替换上面的文本，含你手改的内容。",
                "Regenerating replaces the text above, including your manual edits.",
              )}
            </p>
            {outlineError && <div className="mt-2 text-xs text-[var(--ax-err)]">{outlineError}</div>}
            {outlineConfirming && (
              <div className="mt-3 flex items-center gap-2 text-[11px] text-ink3">
                <span className="ax-spinner" />
                {t("正在生成章节结构…", "Generating chapter structure…")}
              </div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="ax-btn ax-btn-ghost"
                disabled={outlineConfirming || outlineAdjusting}
                onClick={closeOutline}
              >
                {t("取消", "Cancel")}
              </button>
              <button
                className="ax-btn"
                disabled={outlineConfirming || outlineAdjusting}
                onClick={() => void commitOutline(false)}
                title={t(
                  "只创建章节结构与思维导图，正文稍后按需生成",
                  "Creates only the chapter structure and mind map; content is generated later on demand",
                )}
              >
                {t("只生成结构", "Structure only")}
              </button>
              <button
                className="ax-btn ax-btn-primary"
                disabled={outlineConfirming || outlineAdjusting}
                onClick={() => void commitOutline(true)}
                title={t(
                  "创建结构后立即在后台生成整本正文，可随时离开这一页",
                  "Creates the structure and starts generating all content in the background; you can leave this page anytime",
                )}
              >
                {outlineConfirming ? t("正在生成结构…", "Generating structure…") : t("生成整本", "Generate full notebook")}
              </button>
            </div>
          </div>
        </div>
      )}

      {colorTarget && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-6"
          onClick={() => setColorTarget(null)}
        >
          <div className="ax-panel w-full max-w-[420px] p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 flex items-start justify-between gap-4">
              <h2 className="text-[15px] font-semibold">{t("头像配色", "Avatar color")}</h2>
              <button className="ax-icon-btn" title={t("关闭", "Close")} onClick={() => setColorTarget(null)}>
                ×
              </button>
            </div>
            <p className="mb-4 text-[11px] text-mutedfg">
              {t(
                `只改《${colorTarget.title}》在列表里的头像渐变，点选即生效。`,
                `Only changes the avatar gradient for “${colorTarget.title}” in the list. Applies instantly.`,
              )}
            </p>
            <div className="grid grid-cols-4 gap-2">
              {LOGO_PALETTES.map((p) => {
                const active = colorSelected === p.id;
                return (
                  <button
                    key={p.id}
                    className={`rounded-lg border p-1.5 transition-colors ${
                      active ? "border-fg/50 bg-surface2" : "border-border hover:bg-surface"
                    }`}
                    onClick={() => void setNotebookColor(colorTarget.id, p.id)}
                  >
                    <div
                      className="mb-1 h-10 w-full rounded-md"
                      style={{ backgroundImage: gradientOf(p.id) }}
                    />
                    <div className="text-[11px] text-mutedfg">
                      {t(p.name.zh, p.name.en)}
                      {active ? " ✓" : ""}
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="mt-4 flex items-center justify-between">
              <button className="ax-btn ax-btn-ghost text-xs" onClick={() => void setNotebookColor(colorTarget.id, "")}>
                {t("恢复默认", "Reset to default")}
              </button>
              <button className="ax-btn ax-btn-outline" onClick={() => setColorTarget(null)}>
                {t("完成", "Done")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** 工作台风格 chips：前三个直连预设，第四个展开自定义面板 */
const STYLE_CHIPS = [
  { id: "feynman", label: { zh: "费曼讲解", en: "Feynman" } },
  { id: "steps", label: { zh: "结构化提纲", en: "Structured outline" } },
  { id: "exam", label: { zh: "考纲对齐", en: "Exam-aligned" } },
] as const;

/** 设置齿轮：闭合轮廓，避免手绘路径在顶部留缺口 */
function GearIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/** 首页示例主题：点选后填入主题输入框 */
const TOPIC_SUGGESTIONS = [
  { zh: "三周吃透线性代数", en: "Master linear algebra in 3 weeks" },
  { zh: "用费曼法学概率论", en: "Learn probability with the Feynman method" },
  { zh: "考前突击概率论", en: "Cram probability before the exam" },
  { zh: "从零补完微积分", en: "Catch up on calculus from scratch" },
];

function relTime(iso: string, t: (zh: string, en: string) => string): string {
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "";
  const diff = Math.max(0, Date.now() - ms);
  const min = 60_000;
  const hour = 60 * min;
  const day = 24 * hour;
  if (diff < min) return t("刚刚", "just now");
  if (diff < hour) {
    const n = Math.floor(diff / min);
    return t(`${n} 分钟前`, `${n} min ago`);
  }
  if (diff < day) {
    const n = Math.floor(diff / hour);
    return t(`${n} 小时前`, `${n} h ago`);
  }
  if (diff < 7 * day) {
    const d = Math.floor(diff / day);
    return d === 1 ? t("昨天", "yesterday") : t(`${d} 天前`, `${d} days ago`);
  }
  return new Date(iso).toLocaleDateString(t("zh-CN", "en-US"));
}

/** 笔记本列表头像的渐变配色；id 存进 notebook.md 的 color 字段 */
const LOGO_PALETTES: Array<{ id: string; name: { zh: string; en: string }; from: string; to: string }> = [
  { id: "indigo", name: { zh: "靛蓝", en: "Indigo" }, from: "#6366f1", to: "#22d3ee" },
  { id: "violet", name: { zh: "紫粉", en: "Violet" }, from: "#a855f7", to: "#ec4899" },
  { id: "teal", name: { zh: "青绿", en: "Teal" }, from: "#10b981", to: "#06b6d4" },
  { id: "sunset", name: { zh: "落日", en: "Sunset" }, from: "#f59e0b", to: "#ef4444" },
  { id: "ocean", name: { zh: "深海", en: "Ocean" }, from: "#0ea5e9", to: "#4f46e5" },
  { id: "sakura", name: { zh: "樱粉", en: "Sakura" }, from: "#f472b6", to: "#fb7185" },
  { id: "forest", name: { zh: "苔绿", en: "Forest" }, from: "#65a30d", to: "#14b8a6" },
  { id: "graphite", name: { zh: "石墨", en: "Graphite" }, from: "#334155", to: "#94a3b8" },
];

function gradientOf(id?: string): string {
  const p = LOGO_PALETTES.find((x) => x.id === id) ?? LOGO_PALETTES[0];
  return `linear-gradient(135deg, ${p.from}, ${p.to})`;
}
