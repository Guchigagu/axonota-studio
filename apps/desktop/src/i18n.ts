import { useApp } from "./store";
import { pick, type Lang } from "./lib/lang";

export type { Lang };
export { pick };

/** 组件里取当前语言；未选语言时先按中文渲染（首启遮罩会挡住主界面） */
export function useLang(): Lang {
  return useApp((s) => s.settings.language) ?? "zh";
}

/** 组件里的就地翻译函数：t("中文", "English") */
export function useT(): (zh: string, en: string) => string {
  const lang = useLang();
  return (zh: string, en: string) => pick(lang, zh, en);
}
