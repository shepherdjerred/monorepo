import { useEffect, useRef } from "react";
import type * as Monaco from "monaco-editor";
import Editor, { type OnChange } from "@monaco-editor/react";
import { useScoutTheme } from "@scout-for-lol/design-system/runtime";
import "#src/lib/monaco-setup.ts";
import {
  registerScoutQlLanguage,
  updateScoutQlDiagnostics,
  SCOUTQL_LANGUAGE_ID,
} from "#src/lib/scoutql-language.ts";

// Monaco-backed editor for the scoutql report query language. Provides syntax
// highlighting, context-aware autocomplete, hover docs, and live typecheck
// squiggles (all driven by the shared @scout-for-lol/data language core).
// Default export so it can be lazy-loaded (keeps Monaco out of the main bundle).
export default function ReportQueryEditor(props: {
  value: string;
  onChange: (value: string) => void;
}) {
  const { resolvedMode } = useScoutTheme();
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  useEffect(() => {
    return () => {
      resizeObserverRef.current?.disconnect();
    };
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (editor === null || monaco === null) {
      return;
    }
    const model = editor.getModel();
    if (model !== null && model.getValue() !== props.value) {
      model.setValue(props.value);
      updateScoutQlDiagnostics(monaco, model);
    }
  }, [props.value]);

  const refreshDiagnostics = () => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (editor === null || monaco === null) {
      return;
    }
    const model = editor.getModel();
    if (model !== null) {
      updateScoutQlDiagnostics(monaco, model);
    }
  };

  const handleMount = (
    editor: Monaco.editor.IStandaloneCodeEditor,
    monaco: typeof Monaco,
  ) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    registerScoutQlLanguage(monaco);
    const model = editor.getModel();
    if (model !== null && model.getValue() !== props.value) {
      model.setValue(props.value);
    }
    refreshDiagnostics();
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
    refreshDiagnostics();
  };

  return (
    <div
      ref={containerRef}
      className="min-w-0 overflow-hidden rounded-md border border-border"
    >
      <Editor
        width="100%"
        height="180px"
        language={SCOUTQL_LANGUAGE_ID}
        theme={resolvedMode === "dark" ? "vs-dark" : "vs"}
        value={props.value}
        onChange={handleChange}
        onMount={handleMount}
        options={{
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
          // Render suggest/hover popups in a fixed layer on <body> so the small,
          // overflow-hidden editor container doesn't clip them.
          fixedOverflowWidgets: true,
        }}
      />
    </div>
  );
}
