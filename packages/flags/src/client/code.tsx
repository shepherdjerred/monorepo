import { lazy, Suspense } from "react";

export type JsonEditorProps = {
  /** The text shown. Changing it from outside replaces the editor's text. */
  readonly value: string;
  readonly onChange: (text: string) => void;
  /** JSON Schema the text is validated against, as squiggles and hovers. */
  readonly schema: Record<string, unknown>;
  /** Unique per edited flag, e.g. `scout/prod/key`; names the Monaco model. */
  readonly modelPath: string;
  readonly label: string;
  /** Id of the element listing the draft's issues. */
  readonly describedBy?: string | undefined;
  readonly invalid: boolean;
};

export type DiffViewProps = {
  readonly original: string;
  readonly modified: string;
  /** Names both sides, e.g. `{ original: "Stored", modified: "Draft" }`. */
  readonly labels: { readonly original: string; readonly modified: string };
};

// Monaco is several hundred kilobytes; these chunks load the first time an
// editor or diff is shown, never for the flag table.
const MonacoJsonEditor = lazy(() => import("./monaco/json-editor.tsx"));
const MonacoDiffView = lazy(() => import("./monaco/diff-view.tsx"));

/** The text, unstyled by Monaco, while the editor chunk loads. */
function Loading({ text }: { text: string }) {
  return (
    <pre className="fl-code fl-code-loading" aria-busy="true">
      {text}
    </pre>
  );
}

export function JsonEditor(props: JsonEditorProps): React.JSX.Element {
  return (
    <Suspense fallback={<Loading text={props.value} />}>
      <MonacoJsonEditor {...props} />
    </Suspense>
  );
}

export function DiffView(props: DiffViewProps): React.JSX.Element {
  return (
    <Suspense fallback={<Loading text={props.modified} />}>
      <MonacoDiffView {...props} />
    </Suspense>
  );
}
