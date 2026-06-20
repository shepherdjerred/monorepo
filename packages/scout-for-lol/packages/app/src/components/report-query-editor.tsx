import { useRef } from "react";
import type * as Monaco from "monaco-editor";
import Editor, { type OnChange, type OnMount } from "@monaco-editor/react";
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
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);

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

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    registerScoutQlLanguage(monaco);
    refreshDiagnostics();
  };

  const handleChange: OnChange = (value) => {
    props.onChange(value ?? "");
    refreshDiagnostics();
  };

  return (
    <div className="overflow-hidden rounded-md border border-border">
      <Editor
        height="180px"
        language={SCOUTQL_LANGUAGE_ID}
        theme="vs-dark"
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
        }}
      />
    </div>
  );
}
