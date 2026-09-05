// Type declarations for CodeMirror modules (provided by Obsidian at runtime)

declare module "@codemirror/view" {
  export class EditorView {
    state: { doc: { toString: () => string; length: number } };
    constructor(config: { state: unknown; parent: HTMLElement });
    dispatch: (tr: {
      changes: { from: number; to: number; insert: string };
    }) => void;
    destroy: () => void;
    requestMeasure: () => void;
    static updateListener: {
      of: (
        fn: (update: {
          docChanged: boolean;
          state: { doc: { toString: () => string } };
        }) => void,
      ) => unknown;
    };
    static lineWrapping: unknown;
  }
  export function keymap(config: { key: string; run: unknown }[]): unknown;
  export namespace keymap {
    function of(bindings: unknown[]): unknown;
  }
}

declare module "@codemirror/state" {
  export const EditorState: {
    create: (config: { doc: string; extensions: unknown[] }) => unknown;
  };
}

declare module "@codemirror/commands" {
  export const defaultKeymap: unknown[];
  export function history(): unknown;
  export const historyKeymap: unknown[];
}

declare module "@codemirror/language" {
  type HighlightSpec = {
    tag: unknown;
    color?: string;
    fontStyle?: string;
    fontWeight?: string | number;
  };

  type StreamParser<State> = {
    startState: () => State;
    token: (
      stream: {
        sol: () => boolean;
        match: (pattern: RegExp) => RegExpMatchArray | null;
        next: () => string | null;
      },
      state: State,
    ) => string | null;
  };
  export const StreamLanguage: {
    define: <State>(spec: StreamParser<State>) => unknown;
  };

  export const HighlightStyle: {
    define: (specs: readonly HighlightSpec[]) => unknown;
  };

  export const defaultHighlightStyle: unknown;

  export function syntaxHighlighting(
    highlighter: unknown,
    options?: { fallback?: boolean },
  ): unknown;
}

declare module "@lezer/highlight" {
  export const tags: {
    variableName: unknown;
    keyword: unknown;
    number: unknown;
    heading: unknown;
    meta: unknown;
    atom: unknown;
    string: unknown;
    docString: unknown;
    operator: unknown;
    url: unknown;
    comment: unknown;
  };
}
