import { useState } from "react";
import { newId, listModels, testConnection, type ModelConfig } from "@nb/core";
import { fetchFn, isDesktop } from "../lib/env";
import { useApp } from "../store";
import { useT } from "../i18n";

const EMPTY = { baseUrl: "", apiKey: "", modelId: "", name: "" };

/** 常用服务商：只是地址模板（模型 ID 仍从服务商实时拉取），不代表推荐或代付 */
const PROVIDERS = [
  { name: "OpenAI", baseUrl: "https://api.openai.com/v1" },
  { name: "Anthropic", baseUrl: "https://api.anthropic.com/v1", note: "OpenAI 兼容层" },
  { name: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai" },
  { name: "xAI Grok", baseUrl: "https://api.x.ai/v1" },
  { name: "Groq", baseUrl: "https://api.groq.com/openai/v1" },
  { name: "Mistral", baseUrl: "https://api.mistral.ai/v1" },
  { name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1" },
  { name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1" },
];

export function SettingsPage() {
  const t = useT();
  const settings = useApp((s) => s.settings);
  const saveModel = useApp((s) => s.saveModel);
  const removeModel = useApp((s) => s.removeModel);
  const setDefaultModel = useApp((s) => s.setDefaultModel);
  const toggleWebSearch = useApp((s) => s.toggleWebSearch);
  const setTheme = useApp((s) => s.setTheme);
  const setLanguage = useApp((s) => s.setLanguage);
  const openHome = useApp((s) => s.openHome);

  const [form, setForm] = useState(EMPTY);
  const [testing, setTesting] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [options, setOptions] = useState<string[]>([]);
  const [pullMsg, setPullMsg] = useState<{ ok: boolean; message: string } | null>(null);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; message: string } | null>(null);
  /** 测试通过时记录的输入签名；任何一项改动都要重新测，避免拿旧结果添加新配置 */
  const [verifiedKey, setVerifiedKey] = useState<string | null>(null);

  const sig = `${form.baseUrl.trim()}|${form.apiKey.trim()}|${form.modelId.trim()}`;

  function patch(next: Partial<typeof form>, resetOptions = false) {
    setForm({ ...form, ...next });
    setVerifiedKey(null);
    setTestMsg(null);
    setPullMsg(null);
    if (resetOptions) setOptions([]);
  }

  async function pull() {
    if (!form.baseUrl.trim() || !form.apiKey.trim()) return;
    setPulling(true);
    setPullMsg(null);
    setVerifiedKey(null);
    try {
      const ids = await listModels(fetchFn, form);
      setOptions(ids);
      if (!ids.length)
        setPullMsg({ ok: false, message: t("服务商未返回模型列表，可手动填写模型 ID", "The provider returned no models; enter a model ID manually.") });
      else setPullMsg({ ok: true, message: t(`拉到 ${ids.length} 个模型，点选一个`, `Found ${ids.length} models — pick one.`) });
    } catch (err) {
      setPullMsg({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setPulling(false);
    }
  }

  async function test() {
    if (!form.baseUrl.trim() || !form.apiKey.trim() || !form.modelId.trim()) return;
    const target = sig;
    setTesting(true);
    setTestMsg(null);
    const r = await testConnection(fetchFn, form);
    setTestMsg(r);
    setVerifiedKey(r.ok ? target : null);
    setTesting(false);
  }

  async function add() {
    if (verifiedKey !== sig) {
      setTestMsg({ ok: false, message: t("请先测试连通性，通过后才能添加", "Test the connection first; you can add it once it passes.") });
      return;
    }
    const modelId = form.modelId.trim();
    const model: ModelConfig = {
      id: newId("m"),
      // 显示名称只用于自己的列表；留空就用模型 ID
      name: form.name.trim() || modelId,
      baseUrl: form.baseUrl.trim(),
      apiKey: form.apiKey.trim(),
      modelId,
      createdAt: new Date().toISOString(),
    };
    await saveModel(model, settings.models.length === 0);
    setForm(EMPTY);
    setOptions([]);
    setPullMsg(null);
    setTestMsg(null);
    setVerifiedKey(null);
  }

  const readyToTest = !!(form.baseUrl.trim() && form.apiKey.trim() && form.modelId.trim());
  const canAdd = readyToTest && verifiedKey === sig;

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 items-center justify-between border-b border-border px-6">
        <div className="flex items-center gap-3">
          <button className="ax-btn ax-btn-ghost" onClick={openHome}>
            {t("← 返回", "← Back")}
          </button>
          <span className="text-sm font-medium">{t("设置", "Settings")}</span>
        </div>
        <span className="text-[11px] text-ink3">
          {isDesktop ? t("桌面端 · 数据存本机", "Desktop · data stays on this machine") : t("浏览器调试模式", "Browser debug mode")}
        </span>
      </header>

      <main className="ax-scroll flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[760px] px-6 pb-16 pt-8">
          <section className="mb-10">
            <h2 className="ax-h3 mb-1">{t("模型", "Models")}</h2>
            <p className="mb-4 text-xs text-mutedfg">
              {t(
                "自带 API：选服务商模板 → 填 Key → 拉取并点选模型 → 测试连通性通过后才能添加；显示名称直接取模型名。这里不代付、不提供额度，也不预置任何模型。",
                "Bring your own API: pick a provider template → enter your key → fetch and choose a model → test the connection before adding. Axonota does not proxy payments, provide credits, or preconfigure any model.",
              )}
            </p>

            {settings.models.length > 0 && (
              <ul className="mb-4 space-y-2">
                {settings.models.map((m) => (
                  <li key={m.id} className="ax-panel flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        {m.name}
                        {settings.defaultModelId === m.id && (
                          <span className="ax-badge ax-badge-done">{t("默认", "Default")}</span>
                        )}
                      </div>
                      <div className="mt-0.5 truncate text-[11px] text-ink3">
                        {m.baseUrl} · {m.modelId}
                      </div>
                    </div>
                    <button
                      className="ax-btn ax-btn-ghost"
                      disabled={settings.defaultModelId === m.id}
                      onClick={() => void setDefaultModel(m.id)}
                    >
                      {t("设为默认", "Set as default")}
                    </button>
                    <button
                      className="ax-btn ax-btn-ghost"
                      onClick={() => {
                        if (confirm(t(`删除模型「${m.name}」？已生成的内容不受影响。`, `Remove model “${m.name}”? Existing notes are not affected.`)))
                          void removeModel(m.id);
                      }}
                    >
                      {t("删除", "Remove")}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="ax-panel space-y-3 p-4">
              <div>
                <span className="mb-1.5 block text-[11px] text-mutedfg">
                  {t("常用服务商（点一下只填地址，仍用你自己的 Key）", "Common providers (fills in the URL only; your own key is still required)")}
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {PROVIDERS.map((p) => (
                    <button
                      key={p.name}
                      type="button"
                      className={`ax-chip ${form.baseUrl.trim() === p.baseUrl ? "ax-chip-active" : ""}`}
                      title={p.note ? `${p.name} (${p.note})` : p.name}
                      onClick={() => patch({ baseUrl: p.baseUrl }, true)}
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              </div>
              <label className="block">
                <span className="mb-1 block text-[11px] text-mutedfg">
                  {t("服务商地址（OpenAI 兼容）", "Provider URL (OpenAI-compatible)")}
                </span>
                <input
                  className="ax-input"
                  placeholder="https://api.example.com/v1"
                  value={form.baseUrl}
                  onChange={(e) => patch({ baseUrl: e.target.value }, true)}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] text-mutedfg">{t("API Key（只存本机）", "API key (stored locally only)")}</span>
                <input
                  className="ax-input"
                  type="password"
                  placeholder="sk-…"
                  value={form.apiKey}
                  onChange={(e) => patch({ apiKey: e.target.value }, true)}
                />
              </label>
              <div>
                <span className="mb-1 flex items-center gap-2 text-[11px] text-mutedfg">
                  {t("模型", "Model")}
                  {options.length > 0 && (
                    <span className="text-ink3">
                      {t(`服务商返回 ${options.length} 个，点选即用`, `Provider returned ${options.length}; click one to use it`)}
                    </span>
                  )}
                </span>
                {options.length > 0 ? (
                  <select
                    className="ax-input"
                    value={form.modelId}
                    onChange={(e) => patch({ modelId: e.target.value })}
                  >
                    <option value="">{t("选择一个模型…", "Choose a model…")}</option>
                    {options.map((id) => (
                      <option key={id} value={id}>
                        {id}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    className="ax-input"
                    placeholder={t("先拉取模型列表；拉取失败时可手动填写", "Fetch the model list first; enter it manually if fetching fails")}
                    value={form.modelId}
                    onChange={(e) => patch({ modelId: e.target.value })}
                  />
                )}
              </div>
              <label className="block">
                <span className="mb-1 block text-[11px] text-mutedfg">
                  {t("显示名称（可选，只用于你自己的列表）", "Display name (optional, only shown in your own list)")}
                </span>
                <input
                  className="ax-input"
                  placeholder={t("例如：我的 GPT-4o", "e.g. My GPT-4o")}
                  value={form.name}
                  onChange={(e) => patch({ name: e.target.value })}
                />
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  className="ax-btn ax-btn-ghost"
                  disabled={!form.baseUrl.trim() || !form.apiKey.trim() || pulling}
                  onClick={() => void pull()}
                >
                  {pulling ? t("拉取中…", "Fetching…") : t("拉取模型列表", "Fetch model list")}
                </button>
                <button className="ax-btn ax-btn-outline" disabled={!readyToTest || testing} onClick={() => void test()}>
                  {testing
                    ? t("测试中…", "Testing…")
                    : verifiedKey === sig
                      ? t("重新测试", "Test again")
                      : t("测试连通性", "Test connection")}
                </button>
                <button
                  className="ax-btn ax-btn-primary"
                  disabled={!canAdd}
                  title={canAdd ? "" : t("先测试连通性，通过后才能添加", "Test the connection first; you can add it once it passes.")}
                  onClick={() => void add()}
                >
                  {t("添加到列表", "Add to list")}
                </button>
                {pullMsg && (
                  <span className={pullMsg.ok ? "text-xs text-[var(--ax-ok)]" : "text-xs text-[var(--ax-err)]"}>
                    {pullMsg.message}
                  </span>
                )}
                {testMsg && (
                  <span className={testMsg.ok && verifiedKey === sig ? "text-xs text-[var(--ax-ok)]" : "text-xs text-[var(--ax-err)]"}>
                    {testMsg.ok
                      ? verifiedKey === sig
                        ? t(`测试通过：${testMsg.message}`, `Connection OK: ${testMsg.message}`)
                        : t("输入已变化，请重新测试", "Inputs changed — test again")
                      : t(`测试失败：${testMsg.message}`, `Test failed: ${testMsg.message}`)}
                  </span>
                )}
              </div>
            </div>
          </section>

          <section className="mb-10">
            <h2 className="ax-h3 mb-1">{t("语言", "Language")}</h2>
            <p className="mb-4 text-xs text-mutedfg">
              {t(
                "界面与之后生成的笔记都会使用这个语言；已生成的笔记保持原样。",
                "The interface and newly generated notes use this language. Notes generated earlier stay as they are.",
              )}
            </p>
            <div className="flex gap-2">
              <button
                className={`ax-btn ${(settings.language ?? "zh") === "zh" ? "ax-btn-primary" : "ax-btn-outline"}`}
                onClick={() => void setLanguage("zh")}
              >
                中文
              </button>
              <button
                className={`ax-btn ${settings.language === "en" ? "ax-btn-primary" : "ax-btn-outline"}`}
                onClick={() => void setLanguage("en")}
              >
                English
              </button>
            </div>
          </section>

          <section className="mb-10">
            <h2 className="ax-h3 mb-1">{t("外观", "Appearance")}</h2>
            <p className="mb-4 text-xs text-mutedfg">
              {t("主题随应用启动生效，保存在本机设置里。", "The theme is applied at launch and saved in your local settings.")}
            </p>
            <div className="flex gap-2">
              {(["light", "dark"] as const).map((theme) => (
                <button
                  key={theme}
                  className={`ax-btn ${settings.theme === theme ? "ax-btn-primary" : "ax-btn-outline"}`}
                  onClick={() => void setTheme(theme)}
                >
                  {theme === "light" ? t("浅色", "Light") : t("深色", "Dark")}
                </button>
              ))}
            </div>
          </section>

          <section className="mb-10">
            <h2 className="ax-h3 mb-1">{t("联网检索", "Web search")}</h2>
            <p className="mb-4 text-xs text-mutedfg">
              {t(
                "关闭后，生成与对话只使用本机资料；开启时来源会区分「用户上传」与「网络检索」，只列实际抓取到的链接。",
                "When off, generation and chat use local material only. When on, sources distinguish your uploads from web results and list only links actually fetched.",
              )}
            </p>
            <button
              className={`ax-panel flex w-full items-center justify-between px-4 py-3 text-left ${settings.webSearch ? "" : "opacity-80"}`}
              onClick={() => void toggleWebSearch()}
            >
              <span className="text-sm">{settings.webSearch ? t("已开启", "On") : t("已关闭", "Off")}</span>
              <span className={`h-5 w-9 rounded-full p-0.5 transition-colors ${settings.webSearch ? "bg-fg" : "bg-border"}`}>
                <span
                  className={`block h-4 w-4 rounded-full transition-transform ${settings.webSearch ? "translate-x-4 bg-bg" : "bg-card"}`}
                />
              </span>
            </button>
          </section>

          <section>
            <h2 className="ax-h3 mb-1">{t("数据", "Data")}</h2>
            <p className="text-xs text-mutedfg">
              {t(
                "你的笔记本以 Markdown + YAML 存在本地目录；SQLite 只做检索索引。删除笔记本会交给系统回收站。",
                "Notebooks live as Markdown + YAML in a local folder; SQLite is only a search index. Deleting a notebook sends it to the system Recycle Bin.",
              )}
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
