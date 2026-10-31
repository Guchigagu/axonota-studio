import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

export interface FrontMatterDocument {
  data: Record<string, unknown>;
  body: string;
}

const FENCE = "---";

/** 解析 `---\n<yaml>\n---\n<body>`；没有 front matter 时整体视为正文。 */
export function parseFrontMatter(raw: string): FrontMatterDocument {
  if (!raw.startsWith(FENCE)) return { data: {}, body: raw };
  const end = raw.indexOf(`\n${FENCE}`, FENCE.length);
  if (end === -1) return { data: {}, body: raw };
  const yamlText = raw.slice(FENCE.length, end).replace(/^\r?\n/, "");
  const body = raw.slice(end + FENCE.length + 1).replace(/^\r?\n/, "");
  const data = parseYaml(yamlText);
  return { data: (data && typeof data === "object" ? data : {}) as Record<string, unknown>, body };
}

export function stringifyFrontMatter(data: Record<string, unknown>, body: string): string {
  const yamlText = stringifyYaml(data, { lineWidth: 0 }).trimEnd();
  return `${FENCE}\n${yamlText}\n${FENCE}\n\n${body}`;
}
