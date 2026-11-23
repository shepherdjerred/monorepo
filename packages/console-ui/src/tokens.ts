import tokensJson from "./tokens.json" with { type: "json" };

/** Severity vocabulary shared by the consoles and the ops emails. */
export const SEVERITIES = [
  "ok",
  "info",
  "unknown",
  "warning",
  "error",
] as const;
export type Severity = (typeof SEVERITIES)[number];

export type ThemeName = "light" | "dark";
export type TokenName = keyof typeof tokensJson.light;
export type ThemeTokens = Readonly<Record<TokenName, string>>;

/**
 * Every colour token for both themes. `src/tokens.json` is the single source;
 * `src/styles/tokens.css` is generated from it and the ops emails read it.
 */
export const tokens: Readonly<Record<ThemeName, ThemeTokens>> = {
  light: tokensJson.light,
  dark: tokensJson.dark,
};

export function cssVariable(name: TokenName): `--ui-${TokenName}` {
  return `--ui-${name}`;
}

function declarations(theme: ThemeName, indent: string): string {
  return Object.entries(tokens[theme])
    .map(([name, value]) => `${indent}--ui-${name}: ${value};`)
    .join("\n");
}

/** The exact contents of `src/styles/tokens.css`. */
export function renderTokensCss(): string {
  return `/* Generated from src/tokens.json by scripts/generate-tokens.ts. Do not edit. */
@layer ui.tokens {
  :root {
    color-scheme: light;
${declarations("light", "    ")}
  }

  :root[data-theme="dark"] {
    color-scheme: dark;
${declarations("dark", "    ")}
  }

  /* The same dark values: CSS cannot join a selector and a media query in one rule. */
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      color-scheme: dark;
${declarations("dark", "      ")}
    }
  }
}
`;
}
