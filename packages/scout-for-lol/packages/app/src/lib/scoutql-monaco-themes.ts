import type * as Monaco from "monaco-editor";
import { match } from "ts-pattern";
import { scoutThemes } from "@scout-for-lol/design-system/themes";
import type { ScoutQlTokenKind } from "@scout-for-lol/data/model/scoutql/semantic-tokens.ts";
import { SCOUTQL_SEMANTIC_TOKEN_TYPES } from "#src/lib/scoutql-monaco-tokens.ts";

// ── ScoutQL editor themes ────────────────────────────────────────────────────
// Monaco cannot read CSS custom properties: `defineTheme` wants literal
// colours. So rather than duplicating hex values, the mapping is written once
// as `token kind → design-system colour role`, and the roles are resolved
// against the SAME generated token set (`@scout-for-lol/design-system/themes`)
// that produces the `--scout-color-*` variables the rest of the app paints
// with. A palette change therefore reaches the editor without anyone editing
// this file.

export const SCOUTQL_LIGHT_THEME = "scoutql-light";
export const SCOUTQL_DARK_THEME = "scoutql-dark";

type ScoutColorRole = keyof (typeof scoutThemes)["modern-light"]["colors"];

/** How one highlight kind is painted, in role terms rather than hex. */
export type ScoutQlTokenStyle = {
  role: ScoutColorRole;
  bold: boolean;
  italic: boolean;
  underline: boolean;
};

function style(
  role: ScoutColorRole,
  emphasis?: { bold?: boolean; italic?: boolean; underline?: boolean },
): ScoutQlTokenStyle {
  return {
    role,
    bold: emphasis?.bold ?? false,
    italic: emphasis?.italic ?? false,
    underline: emphasis?.underline ?? false,
  };
}

/**
 * The single kind → role table. The ts-pattern match is exhaustive, so adding
 * a member to `ScoutQlTokenKind` in `@scout-for-lol/data` fails typecheck here
 * until the new kind is given a colour.
 *
 * Roles are chosen so the two modes stay legible without hand-tuned per-mode
 * overrides: the chart roles exist precisely because they are distinguishable
 * against both the light and dark canvas.
 */
export function scoutQlTokenStyle(kind: ScoutQlTokenKind): ScoutQlTokenStyle {
  return match(kind)
    .with("keyword", () => style("primary", { bold: true }))
    .with("aggregate", () => style("chart5", { bold: true }))
    .with("function", () => style("chart5"))
    .with("column", () => style("text"))
    .with("alias", () => style("chart7"))
    .with("source", () => style("focus", { bold: true }))
    .with("number", () => style("chart6"))
    .with("string", () => style("chart3"))
    .with("operator", () => style("textMuted"))
    .with("comment", () => style("textMuted", { italic: true }))
    .with("renderKind", () => style("accent", { bold: true }))
    .with("renderOption", () => style("accent"))
    .with("plain", () => style("text"))
    .with("invalid", () => style("danger", { underline: true }))
    .exhaustive();
}

function fontStyle(token: ScoutQlTokenStyle): string {
  return [
    token.bold ? "bold" : "",
    token.italic ? "italic" : "",
    token.underline ? "underline" : "",
  ]
    .filter((part) => part.length > 0)
    .join(" ");
}

function themeRules(mode: "light" | "dark"): Monaco.editor.ITokenThemeRule[] {
  const colors =
    scoutThemes[mode === "dark" ? "modern-dark" : "modern-light"].colors;
  return SCOUTQL_SEMANTIC_TOKEN_TYPES.map((kind) => {
    const token = scoutQlTokenStyle(kind);
    const emphasis = fontStyle(token);
    return {
      token: kind,
      foreground: colors[token.role],
      ...(emphasis.length > 0 ? { fontStyle: emphasis } : {}),
    };
  });
}

function themeData(mode: "light" | "dark"): Monaco.editor.IStandaloneThemeData {
  const theme = scoutThemes[mode === "dark" ? "modern-dark" : "modern-light"];
  return {
    base: mode === "dark" ? "vs-dark" : "vs",
    inherit: true,
    // Monarch emits the same token names for the four kinds it can decide
    // without analysis (keyword/string/number/comment), so one rule set paints
    // both the first-paint layer and the semantic layer.
    rules: themeRules(mode),
    colors: {
      "editor.background": theme.colors.surface,
      "editor.foreground": theme.colors.text,
      "editorLineNumber.foreground": theme.colors.textMuted,
      "editorCursor.foreground": theme.colors.focus,
      "editor.selectionBackground": theme.colors.interactiveActive,
      "editorWidget.background": theme.colors.surfaceRaised,
      "editorWidget.border": theme.colors.border,
      "editorSuggestWidget.background": theme.colors.surfaceRaised,
      "editorSuggestWidget.border": theme.colors.border,
      "editorSuggestWidget.selectedBackground": theme.colors.interactiveHover,
      "editorHoverWidget.background": theme.colors.surfaceRaised,
      "editorHoverWidget.border": theme.colors.border,
      "editorError.foreground": theme.colors.danger,
      "editorWarning.foreground": theme.colors.warning,
      "editorInfo.foreground": theme.colors.info,
    },
  };
}

const definedFor = new WeakSet<object>();

/**
 * Defines `scoutql-light` / `scoutql-dark`. Idempotent per Monaco instance —
 * `defineTheme` is a replace, so re-running is harmless, but the guard keeps
 * mount cheap.
 */
export function defineScoutQlThemes(monaco: typeof Monaco): void {
  if (definedFor.has(monaco)) {
    return;
  }
  definedFor.add(monaco);
  monaco.editor.defineTheme(SCOUTQL_LIGHT_THEME, themeData("light"));
  monaco.editor.defineTheme(SCOUTQL_DARK_THEME, themeData("dark"));
}

/** The theme name for a resolved colour mode. */
export function scoutQlThemeName(mode: "light" | "dark"): string {
  return mode === "dark" ? SCOUTQL_DARK_THEME : SCOUTQL_LIGHT_THEME;
}
