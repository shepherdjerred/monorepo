import { useCallback, useEffect, useRef } from "react";
import type * as Monaco from "monaco-editor";
import Editor, { type OnChange } from "@monaco-editor/react";
import { Button } from "@scout-for-lol/design-system/components/button";
import { useScoutTheme } from "@scout-for-lol/design-system/runtime";
import "#src/lib/monaco-setup.ts";
import {
  registerScoutQlLanguage,
  SCOUTQL_LANGUAGE_ID,
} from "#src/lib/scoutql-monaco-language.ts";
import {
  registerScoutQlProviders,
  updateScoutQlDiagnostics,
} from "#src/lib/scoutql-monaco-providers.ts";
import {
  defineScoutQlThemes,
  scoutQlThemeName,
} from "#src/lib/scoutql-monaco-themes.ts";

// Monaco-backed editor for ScoutQL. Semantic highlighting, context-aware
// completion (with snippets), signature help, hover docs, quick fixes and
// formatting all come from the editor-agnostic language services in
// `@scout-for-lol/data` — this component only wires them to an editor.
// Default export so it can be lazy-loaded (keeps Monaco out of the main bundle).

/**
 * Linting is a full analysis pass, so it is debounced while typing. It is
 * still run immediately on mount and flushed on blur, so a query is never
 * left showing squiggles that belong to text the author already changed.
 */
const LINT_DEBOUNCE_MS = 200;

export default function ReportQueryEditor(props: {
  value: string;
  onChange: (value: string) => void;
}) {
  const { resolvedMode } = useScoutTheme();
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const hasLintedRef = useRef(false);

  useEffect(() => {
    return () => {
      resizeObserverRef.current?.disconnect();
    };
  }, []);

  // Only reads refs, so it is stable and safe as an effect dependency.
  const refreshDiagnostics = useCallback(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (editor === null || monaco === null) {
      return;
    }
    const model = editor.getModel();
    if (model !== null) {
      updateScoutQlDiagnostics(monaco, model);
    }
  }, []);

  // The wrapper is controlled through `value`, so it already owns the model
  // text; this only re-runs the squiggles. Writing the model here too would be
  // a second, competing source of truth and would reset the whole document on
  // every external update. This is also the single lint path per edit: the
  // parent updates `value` on change, so linting from `onChange` as well would
  // run a full-document pass twice per keystroke.
  useEffect(() => {
    if (!hasLintedRef.current) {
      hasLintedRef.current = true;
      refreshDiagnostics();
      return;
    }
    const timer = setTimeout(refreshDiagnostics, LINT_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [props.value, refreshDiagnostics]);

  const handleBeforeMount = (monaco: typeof Monaco) => {
    registerScoutQlLanguage(monaco);
    registerScoutQlProviders(monaco);
    defineScoutQlThemes(monaco);
  };

  const handleMount = (
    editor: Monaco.editor.IStandaloneCodeEditor,
    monaco: typeof Monaco,
  ) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    refreshDiagnostics();
    // Leaving the editor is the moment the author looks at the result, so the
    // pending debounce is flushed rather than waited out.
    editor.onDidBlurEditorText(refreshDiagnostics);
    const container = containerRef.current;
    if (container !== null) {
      resizeObserverRef.current?.disconnect();
      const layout = () => {
        editor.layout({
          width: container.clientWidth,
          height: container.clientHeight,
        });
      };
      resizeObserverRef.current = new ResizeObserver(layout);
      resizeObserverRef.current.observe(container);
      layout();
    }
  };

  const handleChange: OnChange = (value) => {
    props.onChange(value ?? "");
  };

  const handleFormat = () => {
    const editor = editorRef.current;
    if (editor === null) {
      return;
    }
    editor.focus();
    void editor.getAction("editor.action.formatDocument")?.run();
  };

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div
        ref={containerRef}
        className="min-w-0 overflow-hidden rounded-md border border-border"
      >
        <Editor
          width="100%"
          height="180px"
          language={SCOUTQL_LANGUAGE_ID}
          theme={scoutQlThemeName(resolvedMode)}
          value={props.value}
          onChange={handleChange}
          beforeMount={handleBeforeMount}
          onMount={handleMount}
          options={{
            ariaLabel: "ScoutQL query",
            minimap: { enabled: false },
            lineNumbers: "off",
            fontSize: 13,
            scrollBeyondLastLine: false,
            wordWrap: "on",
            padding: { top: 8, bottom: 8 },
            overviewRulerLanes: 0,
            folding: false,
            renderLineHighlight: "none",
            quickSuggestions: { other: true, comments: false, strings: true },
            // The Monarch layer paints only keywords/strings/numbers/comments;
            // columns, aliases, sources and functions need the analysis, which
            // arrives through the semantic token provider.
            "semanticHighlighting.enabled": true,
            // Render suggest/hover popups in a fixed layer on <body> so the small,
            // overflow-hidden editor container doesn't clip them.
            fixedOverflowWidgets: true,
          }}
        />
      </div>
      <div className="flex justify-end">
        <Button type="button" variant="ghost" size="sm" onClick={handleFormat}>
          Format
        </Button>
      </div>
    </div>
  );
}
