/** rehype 插件：把用户高亮的原文在渲染结果里标成 <mark>。只匹配单个文本节点内的原文。 */

export interface HighlightText {
  text: string;
}

interface HastNode {
  type: string;
  value?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

function splitText(value: string, list: HighlightText[]): HastNode[] {
  const out: HastNode[] = [];
  let rest = value;
  while (rest) {
    let at = -1;
    let hit: HighlightText | null = null;
    for (const item of list) {
      const idx = rest.indexOf(item.text);
      if (idx !== -1 && (at === -1 || idx < at)) {
        at = idx;
        hit = item;
      }
    }
    if (!hit || at < 0) {
      out.push({ type: "text", value: rest });
      break;
    }
    if (at > 0) out.push({ type: "text", value: rest.slice(0, at) });
    out.push({
      type: "element",
      tagName: "mark",
      properties: { className: ["ax-hl"] },
      children: [{ type: "text", value: hit.text }],
    });
    rest = rest.slice(at + hit.text.length);
  }
  return out;
}

export function rehypeHighlights(options?: { list?: HighlightText[] }) {
  const list = (options?.list ?? [])
    .map((h) => ({ text: h.text.trim() }))
    .filter((h) => h.text)
    .sort((a, b) => b.text.length - a.text.length);
  return (tree: HastNode) => {
    if (!list.length) return;
    const walk = (node: HastNode) => {
      if (!Array.isArray(node.children)) return;
      const next: HastNode[] = [];
      for (const child of node.children) {
        if (child.type === "text" && child.value) {
          next.push(...splitText(child.value, list));
          continue;
        }
        if (child.type === "element" && child.tagName === "code") {
          next.push(child);
          continue;
        }
        walk(child);
        next.push(child);
      }
      node.children = next;
    };
    walk(tree);
  };
}
