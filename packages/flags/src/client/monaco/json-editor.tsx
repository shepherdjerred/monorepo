import { useEffect, useRef } from "react";
import type { JsonEditorProps } from "@shepherdjerred/flags/client/code.tsx";
import { useResolvedTheme } from "@shepherdjerred/flags/client/theme-context.ts";
import * as monaco from "monaco-editor/editor/editor.api.js";
import { applyTheme, baseOptions, registerSchema } from "./runtime.ts";

const MIN_HEIGHT = 96;
const MAX_HEIGHT = 440;

function clampHeight(content: number): number {
  return Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.ceil(content)));
}

/** A JSON editor validated against `schema`; grows with its text up to a cap. */
export default function JsonEditor({
  value,
  onChange,
  schema,
  modelPath,
  label,
  describedBy,
  invalid,
}: JsonEditorProps): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | undefined>(
    undefined,
  );
  const latest = useRef({ value, onChange });
  // Set while this component replaces the text, so that change is not echoed back.
  const replacing = useRef(false);
  const theme = useResolvedTheme();

  useEffect(() => {
    latest.current = { value, onChange };
  });

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    const element = host.current;
    if (element === null) throw new Error("the JSON editor has no host");
    const uri = monaco.Uri.parse(`inmemory://flags/${modelPath}.json`);
    monaco.editor.getModel(uri)?.dispose();
    const model = monaco.editor.createModel(latest.current.value, "json", uri);
    // Matches `JSON.stringify(value, null, 2)`, which wrote the text.
    model.updateOptions({ tabSize: 2, insertSpaces: true });
    const release = registerSchema(uri.toString(), schema);
    const editor = monaco.editor.create(element, {
      ...baseOptions(),
      model,
      ariaLabel: label,
      wordWrap: "on",
      wrappingIndent: "indent",
      formatOnPaste: true,
      quickSuggestions: { strings: true, other: true, comments: false },
    });
    editorRef.current = editor;
    const resize = editor.onDidContentSizeChange((event) => {
      element.style.height = `${String(clampHeight(event.contentHeight))}px`;
    });
    element.style.height = `${String(clampHeight(editor.getContentHeight()))}px`;
    const changes = model.onDidChangeContent(() => {
      if (replacing.current) return;
      latest.current.onChange(model.getValue());
    });
    return () => {
      changes.dispose();
      resize.dispose();
      editor.dispose();
      model.dispose();
      release();
      editorRef.current = undefined;
    };
  }, [modelPath, schema, label]);

  // Text replaced from outside (loading their version) goes into the model;
  // text the user typed already matches it.
  useEffect(() => {
    const model = editorRef.current?.getModel();
    if (model === null || model === undefined || model.getValue() === value)
      return;
    replacing.current = true;
    try {
      model.setValue(value);
    } finally {
      replacing.current = false;
    }
  }, [value]);

  // Monaco owns its textarea, so its accessible description is set here.
  useEffect(() => {
    const input = host.current?.querySelector("textarea");
    if (input === null || input === undefined) return;
    if (describedBy === undefined) input.removeAttribute("aria-describedby");
    else input.setAttribute("aria-describedby", describedBy);
    if (invalid) input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
  });

  return (
    <div
      ref={host}
      className="fl-code fl-code-editor"
      data-invalid={invalid ? "" : undefined}
    />
  );
}
