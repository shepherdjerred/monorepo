import { useEffect, useRef } from "react";
import type { DiffViewProps } from "@shepherdjerred/flags/client/code.tsx";
import { useResolvedTheme } from "@shepherdjerred/flags/client/theme-context.ts";
import * as monaco from "monaco-editor/editor/editor.api.js";
import { applyTheme, baseOptions } from "./runtime.ts";

const MIN_HEIGHT = 80;
const MAX_HEIGHT = 380;

/**
 * A read-only diff of two JSON texts: side by side when there is room,
 * inline when the container is narrow. Tab moves focus through it, so the
 * dialog around it keeps its keyboard order.
 */
export default function DiffView({
  original,
  modified,
  labels,
}: DiffViewProps): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  const theme = useResolvedTheme();

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    const element = host.current;
    if (element === null) throw new Error("the diff view has no host");
    const before = monaco.editor.createModel(original, "json");
    const after = monaco.editor.createModel(modified, "json");
    const diff = monaco.editor.createDiffEditor(element, {
      ...baseOptions(),
      readOnly: true,
      originalEditable: false,
      domReadOnly: true,
      tabFocusMode: true,
      renderSideBySide: true,
      useInlineViewWhenSpaceIsLimited: true,
      renderSideBySideInlineBreakpoint: 560,
      renderOverviewRuler: false,
      renderIndicators: true,
      ignoreTrimWhitespace: false,
      wordWrap: "on",
      diffWordWrap: "on",
      originalAriaLabel: labels.original,
      modifiedAriaLabel: labels.modified,
    });
    diff.setModel({ original: before, modified: after });
    const sides = [diff.getOriginalEditor(), diff.getModifiedEditor()];
    function resize(): void {
      const content = Math.max(...sides.map((side) => side.getContentHeight()));
      const height = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, content));
      if (element !== null) element.style.height = `${String(height)}px`;
    }
    const subscriptions = sides.map((side) =>
      side.onDidContentSizeChange(resize),
    );
    resize();
    return () => {
      for (const subscription of subscriptions) subscription.dispose();
      diff.dispose();
      before.dispose();
      after.dispose();
    };
  }, [original, modified, labels.original, labels.modified]);

  return <div ref={host} className="fl-code fl-code-diff" />;
}
