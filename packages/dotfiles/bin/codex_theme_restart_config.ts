import type { Appearance } from "./codex_theme_restart_options.ts";

/** Must match the `codex` wrapper's darwin selection and the Catppuccin palettes in Herdr. */
export function themeForAppearance(mode: Appearance): string {
  return mode === "dark" ? "catppuccin-mocha" : "catppuccin-latte";
}

const themeOverride = /^\s*tui\.theme\s*=(.*)$/s;

/** Whether one `-c`/`--config` value overrides `tui.theme`. */
export function isThemeOverride(value: string): boolean {
  return themeOverride.test(value);
}

function tomlString(value: string): string {
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'"))
    return value.slice(1, -1);
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "string")
      throw new TypeError("Invalid tui.theme override");
    return parsed;
  }
  // Codex treats a value that is not valid TOML as a literal string.
  return value;
}

/**
 * The theme a running Codex was launched with from its `-c tui.theme=...`
 * overrides (the last one wins), or undefined when it uses its config file.
 */
export function launchedTheme(argv: readonly string[]): string | undefined {
  let theme: string | undefined;
  for (let index = 1; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === undefined || argument === "--") break;
    let value: string | undefined;
    if (argument === "-c" || argument === "--config") value = argv[++index];
    else if (argument.startsWith("-c=") || argument.startsWith("--config="))
      value = argument.slice(argument.indexOf("=") + 1);
    const match = value === undefined ? null : themeOverride.exec(value);
    if (match?.[1] !== undefined) theme = tomlString(match[1].trim());
  }
  return theme;
}
