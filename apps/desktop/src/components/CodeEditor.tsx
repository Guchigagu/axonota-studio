import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";

interface Props {
  value: string;
  onChange: (value: string) => void;
  dark: boolean;
}

/** 纯 Markdown 编辑器：AI 流式输出与手工修订都用同一个视图。 */
export function CodeEditor({ value, onChange, dark }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!host.current) return;
    const state = EditorState.create({
      doc: value,
      extensions: [
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        lineNumbers(),
        highlightActiveLine(),
        markdown(),
        EditorView.lineWrapping,
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChangeRef.current(u.state.doc.toString());
        }),
        EditorView.theme({
          "&": {
            fontSize: "13.5px",
            fontFamily: "var(--ax-font-mono)",
            backgroundColor: "transparent",
            color: "var(--ax-ink-2)",
            height: "100%",
          },
          ".cm-content": { padding: "18px 0", lineHeight: "1.8" },
          ".cm-gutters": { backgroundColor: "transparent", border: "none", color: "var(--ax-ink-3)" },
          ".cm-activeLine": { backgroundColor: "transparent" },
          "&.cm-focused": { outline: "none" },
        }),
      ],
    });
    const v = new EditorView({ state, parent: host.current });
    view.current = v;
    return () => {
      v.destroy();
      view.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dark]);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const current = v.state.doc.toString();
    if (current !== value) {
      v.dispatch({ changes: { from: 0, to: current.length, insert: value } });
    }
  }, [value]);

  return <div ref={host} className="h-full overflow-auto px-6" />;
}
