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

/**
 * Layout breakpoints in CSS pixels. Stylesheets write these numbers in their
 * media queries (CSS cannot read a custom property there); scripts use these
 * constants, and the vocabulary test keeps the two in step.
 *
 * - `sidebar`: at or below this width the sidebar gives way to the phone top
 *   bar and its navigation drawer.
 * - `phone`: at or below this width the panel loses its inset, gutters
 *   narrow to 16px and header bars wrap.
 */
export const BREAKPOINTS: Readonly<{ phone: number; sidebar: number }> =
  tokensJson.breakpoints;

/** Matches while the sidebar shows, i.e. above the `sidebar` breakpoint. */
export const SIDEBAR_QUERY = `(width > ${String(BREAKPOINTS.sidebar)}px)`;

export function cssVariable(name: TokenName): `--ui-${TokenName}` {
  return `--ui-${name}`;
}

function declarations(
  values: Readonly<Record<string, string>>,
  indent: string,
): string {
  return Object.entries(values)
    .map(([name, value]) => `${indent}--ui-${name}: ${value};`)
    .join("\n");
}

function themed(theme: ThemeName, indent: string): string {
  return [
    declarations(tokens[theme], indent),
    declarations(tokensJson.translucent[theme], indent),
  ].join("\n");
}

/** The exact contents of `src/styles/tokens.css`. */
export function renderTokensCss(): string {
  return `/* Generated from src/tokens.json by scripts/generate-tokens.ts. Do not edit. */
@layer ui.tokens {
  :root {
    color-scheme: light;
${declarations(tokensJson.scale, "    ")}
${themed("light", "    ")}
  }

  /* Touch screens keep 28px controls but give them 44px hit areas. */
  @media (pointer: coarse) {
    :root {
${declarations(tokensJson.coarse, "      ")}
    }
  }

  @media (width <= ${String(BREAKPOINTS.phone)}px) {
    :root {
${declarations(tokensJson.phone, "      ")}
    }
  }

  :root[data-theme="dark"] {
    color-scheme: dark;
${themed("dark", "    ")}
  }

  /* The same dark values: CSS cannot join a selector and a media query in one rule. */
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      color-scheme: dark;
${themed("dark", "      ")}
    }
  }
}
`;
}
