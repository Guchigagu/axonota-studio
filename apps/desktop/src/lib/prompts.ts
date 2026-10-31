/** 提示词库直接从仓库根目录的 prompts/ 读取，构建时内联为字符串，运行时无需读盘。 */
const files = import.meta.glob("../../../../prompts/**/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function normalize(path: string): string {
  const idx = path.indexOf("prompts/");
  return idx === -1 ? path : path.slice(idx + "prompts/".length);
}

export const promptFiles: Record<string, string> = Object.fromEntries(
  Object.entries(files).map(([k, v]) => [normalize(k), v]),
);
