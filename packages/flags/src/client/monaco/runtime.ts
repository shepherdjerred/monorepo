/*
 * Monaco, bundled locally with only the JSON language: the core editor API,
 * the JSON language service and its worker, and the base editor worker. No
 * basic-language tokenizers and no CSS, HTML or TypeScript services or
 * workers are bundled. Only this module's lazy chunk loads it, so the flag
 * table never pays for the editor.
 */
import * as monaco from "monaco-editor/editor/editor.api.js";
// The JSON language service's worker client (`internal/common/workers.js`)
// side-effect-imports the standard editor contributions and the services they
// register. Monaco fixes its service set when the first editor is created, so
// this module must run before then; left to the JSON mode's own lazy import,
// later editors fail with "depends on UNKNOWN service" errors.
import "monaco-editor/internal/common/workers.js";
import { jsonDefaults } from "monaco-editor/languages/features/json/register.js";
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker";
import JsonWorker from "monaco-editor/languages/features/json/json.worker.js?worker";
import type { ResolvedTheme } from "@shepherdjerred/console-ui";

// Workers come from this bundle, never a CDN: the JSON language service runs
// in its own worker, everything else in the base editor worker.
globalThis.MonacoEnvironment = {
  getWorker: (_workerId, label) =>
    label === "json" ? new JsonWorker() : new EditorWorker(),
};

/** A model URI's JSON Schema, keyed by the model URI so `fileMatch` is exact. */
const schemas = new Map<string, Record<string, unknown>>();

function publishSchemas(): void {
  jsonDefaults.setDiagnosticsOptions({
    validate: true,
    // `JSON.parse` decides what Flags accepts, so the editor flags what it rejects.
    allowComments: false,
    comments: "error",
    trailingCommas: "error",
    enableSchemaRequest: false,
    schemaValidation: "error",
    schemas: [...schemas.entries()].map(([modelUri, schema]) => ({
      uri: `${modelUri}.schema.json`,
      fileMatch: [modelUri],
      schema,
    })),
  });
}

/** Validates the model at `modelUri` against `schema` until the returned release runs. */
export function registerSchema(
  modelUri: string,
  schema: Record<string, unknown>,
): () => void {
  schemas.set(modelUri, schema);
  publishSchemas();
  return () => {
    schemas.delete(modelUri);
    publishSchemas();
  };
}

const HEX = /^#(?:[\da-f]{3}|[\da-f]{6})$/iu;

/**
 * A console-ui colour token as Monaco wants it (`#rrggbb`). The production
 * CSS minifier shortens `#ffffff` to `#fff`, so short hex is expanded.
 */
function token(style: CSSStyleDeclaration, name: string): string {
  const value = style.getPropertyValue(`--ui-${name}`).trim();
  if (!HEX.test(value)) {
    throw new Error(
      `console-ui token --ui-${name} is not a hex colour: ${value}`,
    );
  }
  return value.length === 4
    ? `#${value.slice(1).replaceAll(/[\da-f]/giu, "$&$&")}`
    : value;
}

/** `#rrggbb` with an alpha byte, for translucent selections and diff fills. */
function alpha(hex: string, opacity: number): string {
  const byte = Math.round(opacity * 255)
    .toString(16)
    .padStart(2, "0");
  return `${hex}${byte}`;
}

/** The console-ui monospace stack, read from the page. */
export function monoFont(): string {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue("--ui-font-mono")
    .trim();
  if (value.length === 0) throw new Error("console-ui --ui-font-mono is unset");
  return value;
}

const THEME_NAME: Readonly<Record<ResolvedTheme, string>> = {
  light: "flags-light",
  dark: "flags-dark",
};

/**
 * Defines and applies the Monaco theme for `theme` from the console-ui
 * tokens on the page right now, so the editor sits flush with the panel.
 * Call it after the theme store has updated `html[data-theme]`.
 */
export function applyTheme(theme: ResolvedTheme): void {
  const style = getComputedStyle(document.documentElement);
  const color = (name: string) => token(style, name);
  const bare = (name: string) => color(name).slice(1);
  const name = THEME_NAME[theme];
  monaco.editor.defineTheme(name, {
    base: theme === "dark" ? "vs-dark" : "vs",
    inherit: true,
    rules: [
      { token: "", foreground: bare("ink") },
      { token: "string.key.json", foreground: bare("sev-info-text") },
      { token: "string.value.json", foreground: bare("sev-ok-text") },
      { token: "number", foreground: bare("sev-warning-text") },
      { token: "keyword", foreground: bare("accent") },
      { token: "delimiter", foreground: bare("muted") },
    ],
    colors: {
      "editor.background": color("panel"),
      "editor.foreground": color("ink"),
      "editorGutter.background": color("panel"),
      "editorLineNumber.foreground": color("faint"),
      "editorLineNumber.activeForeground": color("ink-2"),
      "editor.lineHighlightBackground": color("hover"),
      "editor.lineHighlightBorder": color("hover"),
      "editorCursor.foreground": color("accent"),
      "editor.selectionBackground": alpha(color("accent"), 0.28),
      "editor.inactiveSelectionBackground": alpha(color("accent"), 0.16),
      "editor.wordHighlightBackground": alpha(color("sev-info"), 0.16),
      "editorIndentGuide.background1": color("line-soft"),
      "editorIndentGuide.activeBackground1": color("line"),
      "editorBracketMatch.border": color("btn-edge"),
      "editorBracketMatch.background": color("active"),
      "editorWidget.background": color("panel"),
      "editorWidget.foreground": color("ink"),
      "editorWidget.border": color("line"),
      "editorHoverWidget.background": color("head"),
      "editorHoverWidget.border": color("line"),
      "editorSuggestWidget.background": color("panel"),
      "editorSuggestWidget.border": color("line"),
      "editorSuggestWidget.selectedBackground": color("active"),
      "editorError.foreground": color("sev-error"),
      "editorWarning.foreground": color("sev-warning"),
      "editorInfo.foreground": color("sev-info"),
      focusBorder: color("accent"),
      "scrollbarSlider.background": alpha(color("muted"), 0.25),
      "scrollbarSlider.hoverBackground": alpha(color("muted"), 0.4),
      "scrollbarSlider.activeBackground": alpha(color("muted"), 0.5),
      "diffEditor.insertedTextBackground": alpha(color("sev-ok"), 0.22),
      "diffEditor.removedTextBackground": alpha(color("sev-error"), 0.22),
      "diffEditor.insertedLineBackground": color("sev-ok-soft"),
      "diffEditor.removedLineBackground": color("sev-error-soft"),
      "diffEditorGutter.insertedLineBackground": color("sev-ok-soft"),
      "diffEditorGutter.removedLineBackground": color("sev-error-soft"),
      "diffEditor.border": color("line"),
      "diffEditor.unchangedRegionBackground": color("head"),
      "diffEditor.unchangedRegionForeground": color("muted"),
    },
  });
  monaco.editor.setTheme(name);
}

/** Options every Flags editor shares. */
export function baseOptions(): monaco.editor.IEditorOptions {
  return {
    fontFamily: monoFont(),
    fontSize: 12.5,
    lineHeight: 19,
    fontLigatures: false,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    renderLineHighlight: "line",
    overviewRulerLanes: 0,
    hideCursorInOverviewRuler: true,
    overviewRulerBorder: false,
    lineNumbersMinChars: 3,
    folding: true,
    padding: { top: 8, bottom: 8 },
    automaticLayout: true,
    fixedOverflowWidgets: true,
    scrollbar: { alwaysConsumeMouseWheel: false, useShadows: false },
    stickyScroll: { enabled: false },
  };
}
