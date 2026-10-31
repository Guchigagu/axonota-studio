export type Lang = "zh" | "en";

/** 一行就地翻译：中文界面取 zh，英文界面取 en。未选择语言时按中文展示等首启选择。 */
export function pick(lang: Lang | undefined, zh: string, en: string): string {
  return lang === "en" ? en : zh;
}

/** 讲解风格的英文名与说明：核心预设只存中文，界面按语言取 */
export const PRESET_EN: Record<string, { name: string; desc: string }> = {
  feynman: {
    name: "Feynman style",
    desc: "Plain language first: intuition and examples, then definitions; you can restate each part in your own words.",
  },
  steps: {
    name: "Step by step",
    desc: "Organized into actionable steps: inputs, actions, and expected results for each, so you can follow along.",
  },
  exam: {
    name: "Exam-focused",
    desc: "Built around what gets tested or asked: conclusions and criteria first, then common pitfalls, minimal buildup.",
  },
  analogy: {
    name: "Analogies",
    desc: "Use familiar things as analogies, and point out exactly where the analogy breaks down.",
  },
};
