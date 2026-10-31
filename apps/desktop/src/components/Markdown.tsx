import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { rehypeHighlights, type HighlightText } from "../lib/highlight";

/** 渲染 Markdown 子集：正文、表格、代码、公式；[[cite:n]] 渲染成可读的编号标记。 */
export function Markdown({ text, highlights }: { text: string; highlights?: HighlightText[] }) {
  // 中文里常见「**强调。**后面接着写」，右边界紧贴汉字时 CommonMark 判定不了闭合，
  // 会把 ** 当成字面量。闭合处补一个细空格（U+2009，属于 CommonMark 认可的空白），
  // 既满足解析规则，视觉上也几乎看不出来。
  const boldFixed = text.replace(/\*\*([^*\n]+?)\*\*/g, (m, _inner, offset: number, source: string) => {
    const after = source.charAt(offset + m.length);
    return after && !/\s/.test(after) ? `${m}\u2009` : m;
  });
  const prepared = boldFixed.replace(/\[\[cite:([\d,\s]+)\]\]/g, (_m, ns: string) => {
    const list = ns.replace(/\s/g, "");
    return `\`〔${list}〕\``;
  });
  return (
    <div className="ax-prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[
          [rehypeKatex, { throwOnError: false, strict: false }],
          [rehypeHighlights, { list: highlights ?? [] }],
        ]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {prepared}
      </ReactMarkdown>
    </div>
  );
}
