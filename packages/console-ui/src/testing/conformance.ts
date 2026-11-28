import path from "node:path";
import { z } from "zod";
import {
  classesOf,
  isStyleRule,
  parseCss,
  selectorsOf,
  subjectOf,
} from "@shepherdjerred/console-ui/testing/css.ts";
import { tokens } from "@shepherdjerred/console-ui/tokens.ts";

/**
 * The per-app scan (check 2). An app's test calls `checkConformance` with
 * its client directory and an allowlist of today's violations; the scan
 * fails when a count rises (a new violation) or falls (the allowlist must
 * shrink with the fix), so the list can only get shorter.
 */

export const CONFORMANCE_RULES = {
  "colour-literal":
    "Colours come only from `var(--ui-*)` tokens: no hex, rgb()/hsl()/oklch() or white/black.",
  "token-redefinition": "Apps never redefine a `--ui-*` token.",
  "font-family":
    "Type faces come only from `var(--ui-font-sans)` and `var(--ui-font-mono)`.",
  "shared-class-patch":
    "No rule may style a `.ui-*` class: change console-ui instead of patching it.",
  "local-copy":
    "No local copy of a shared piece (top bar, drawer, panel, badge, eyebrow, dialog, banner, state, picker, …).",
  "inline-typography":
    "No inline font size, weight, family, letter-spacing or text-transform in TSX.",
  "deprecated-import": "No imports of deprecated console-ui pieces.",
  "deprecated-prop": 'No `size="page"` buttons.',
  "deprecated-class":
    "No deprecated page-kit classes (`ui-data`, `ui-summary*`, `ui-eyebrow`, `ui-card`, …).",
  "theme-store-key":
    "`createThemeStore()` takes the shared default key (`ops-theme`).",
  "theme-color":
    "index.html has light and dark `theme-color` metas equal to the `bg` token.",
} as const;

export type ConformanceRule = keyof typeof CONFORMANCE_RULES;

const AllowlistSchema = z.array(
  z.strictObject({
    rule: z.string(),
    /** Relative to the package root, with forward slashes. */
    file: z.string(),
    /** The exact number of violations the file holds today. */
    count: z.number().int().nonnegative(),
    /** Why it is still there, usually the PR that removes it. */
    reason: z.string(),
  }),
);

export type AllowlistEntry = z.infer<typeof AllowlistSchema>[number];

/** The allowlist file an app keeps beside its `conformance.test.ts`. */
export const ALLOWLIST_FILE = "conformance-allowlist.json";

export type ConformanceCount = {
  readonly rule: ConformanceRule;
  readonly file: string;
  readonly count: number;
};

export type ConformanceOptions = {
  /** More directories to scan, relative to `directory`, e.g. `["../styles"]`. */
  readonly also?: readonly string[];
  /**
   * The package root that file paths are relative to and that holds
   * index.html; defaults to the nearest directory with a package.json.
   */
  readonly root?: string;
};

const DEPRECATED_EXPORTS = new Set([
  "PageBody",
  "PageHeading",
  "SummaryGrid",
  "Card",
  "CardToolbar",
  "Tag",
  "Segmented",
  "TopBar",
  "ThemeToggle",
  "SeverityBadge",
]);

const DEPRECATED_CLASS =
  /\bui-(?:data(?:-scroll)?|summary(?:-card)?|eyebrow|input|select|block-head|page(?:-head|-title|-lede|-actions)?|card(?:-toolbar)?|tag|segmented(?:-count)?|badge(?:-icon|-large)?)(?![\w-])/g;

const LOCAL_COPY_NAMES = new Set([
  "topbar",
  "nav-drawer",
  "icon-button",
  "panel",
  "badge",
  "eyebrow",
  "page-header",
  "segmented",
  "button",
  "skip-link",
]);

const LOCAL_COPY_PATTERN =
  /-dialog(?:-|$)|-banner$|-state$|-mobile-bar$|-kpi-card$|-picker$/;

const COLOUR_LITERAL =
  /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(|\b(?:white|black)\b/gi;

const INLINE_TYPOGRAPHY =
  /\b(?:fontSize|fontWeight|fontFamily|letterSpacing|textTransform)\s*:/g;

/** A first argument other than none, `undefined` or the shared key. */
const CUSTOM_THEME_KEY =
  /\bcreateThemeStore\(\s*(?!\)|undefined\b|["']ops-theme["']|THEME_STORAGE_KEY\b)/g;

const TOKEN_FONT = /^(?:var\(--ui-font-(?:sans|mono)\)|inherit|initial|unset)$/;

function isLocalCopy(name: string): boolean {
  return (
    !name.startsWith("ui-") &&
    (LOCAL_COPY_NAMES.has(name) || LOCAL_COPY_PATTERN.test(name))
  );
}

function count(pattern: RegExp, text: string): number {
  return [...text.matchAll(pattern)].length;
}

function fontViolation(property: string, value: string): boolean {
  const usesToken = TOKEN_FONT.test(value);
  return property === "font-family"
    ? !usesToken
    : property === "font" && !value.includes("var(--ui-font-") && !usesToken;
}

type Counter = (rule: ConformanceRule, amount?: number) => void;

function counter(found: Map<ConformanceRule, number>): Counter {
  return (rule, amount = 1) => {
    if (amount > 0) found.set(rule, (found.get(rule) ?? 0) + amount);
  };
}

function withoutStrings(value: string): string {
  return value.replaceAll(/"[^"]*"|'[^']*'/g, "");
}

/**
 * Whether a selector restyles a shared piece: its subject carries a `.ui-*`
 * class, or the subject has no class or id of its own and is reached only
 * through a `.ui-*` ancestor (`.ui-table tbody th`).
 */
function patchesSharedClass(selector: string): boolean {
  const subject = subjectOf(selector);
  const sharedSubject = /\.ui-[\w-]/.test(subject);
  const anonymousSubject = !/[.#][\w-]/.test(subject);
  return sharedSubject || (anonymousSubject && /\.ui-[\w-]/.test(selector));
}

function scanSelectors(selectors: readonly string[], add: Counter): void {
  for (const selector of selectors) {
    if (patchesSharedClass(selector)) add("shared-class-patch");
    const copies = classesOf(selector).filter((name) => isLocalCopy(name));
    add("local-copy", new Set(copies).size);
  }
}

/** Violations in one stylesheet, by rule. */
export function scanStylesheet(css: string): Map<ConformanceRule, number> {
  const found = new Map<ConformanceRule, number>();
  const add = counter(found);
  for (const block of parseCss(css)) {
    for (const { property, value } of block.declarations) {
      add("colour-literal", count(COLOUR_LITERAL, withoutStrings(value)));
      if (property.startsWith("--ui-")) add("token-redefinition");
      if (fontViolation(property, value)) add("font-family");
    }
    if (isStyleRule(block)) scanSelectors(selectorsOf(block), add);
  }
  return found;
}

function importedNames(source: string): string[] {
  const imports = source.matchAll(
    /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["']@shepherdjerred\/console-ui(?:\/[^"']*)?["']/g,
  );
  return [...imports].flatMap((match) =>
    (match[1] ?? "").split(",").flatMap((specifier) => {
      const name = specifier
        .trim()
        .replace(/^type\s+/, "")
        .split(/\s+as\s+/)[0]
        ?.trim();
      return name === undefined || name === "" ? [] : [name];
    }),
  );
}

/** Violations in one TypeScript or TSX module, by rule. */
export function scanModule(
  source: string,
  isTsx: boolean,
): Map<ConformanceRule, number> {
  const found = new Map<ConformanceRule, number>();
  const add = (rule: ConformanceRule, amount: number): void => {
    if (amount > 0) found.set(rule, amount);
  };
  if (isTsx) add("inline-typography", count(INLINE_TYPOGRAPHY, source));
  add(
    "deprecated-import",
    importedNames(source).filter((name) => DEPRECATED_EXPORTS.has(name)).length,
  );
  add("deprecated-prop", count(/\bsize=\{?["']page["']\}?/g, source));
  add("deprecated-class", count(DEPRECATED_CLASS, source));
  add("theme-store-key", count(CUSTOM_THEME_KEY, source));
  return found;
}

function attribute(tag: string, name: string): string | undefined {
  return new RegExp(String.raw`\b${name}\s*=\s*"([^"]*)"`, "i").exec(tag)?.[1];
}

/** Light and dark `theme-color` metas must carry the `bg` token. */
export function scanIndexHtml(html: string): number {
  const metas = [...html.matchAll(/<meta\b[^>]*>/gi)]
    .map((match) => match[0])
    .filter((tag) => attribute(tag, "name") === "theme-color");
  const has = (scheme: "light" | "dark"): boolean =>
    metas.some(
      (tag) =>
        (attribute(tag, "media") ?? "").includes(scheme) &&
        attribute(tag, "content")?.toLowerCase() === tokens[scheme].bg,
    );
  const unscoped = metas.filter((tag) => attribute(tag, "media") === undefined);
  return (has("light") ? 0 : 1) + (has("dark") ? 0 : 1) + unscoped.length;
}

const SKIPPED_DIRECTORIES = new Set([
  "node_modules",
  "dist",
  "generated",
  "e2e",
  "fixtures",
  "test-fixtures",
]);

const SOURCES = new Bun.Glob("**/*.{css,ts,tsx}");

function isScanned(relative: string): boolean {
  const segments = relative.split("/");
  const name = segments.at(-1) ?? "";
  return (
    !segments.some((segment) => SKIPPED_DIRECTORIES.has(segment)) &&
    !/\.(?:test|spec)\.tsx?$/.test(name) &&
    !name.endsWith(".d.ts")
  );
}

async function sourceFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for await (const relative of SOURCES.scan({ cwd: directory })) {
    const normalised = relative.split(path.sep).join("/");
    if (isScanned(normalised)) files.push(path.join(directory, relative));
  }
  return files;
}

/** The nearest directory at or above `directory` holding a package.json. */
export async function packageRootOf(directory: string): Promise<string> {
  let current = path.resolve(directory);
  while (!(await Bun.file(path.join(current, "package.json")).exists())) {
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(`No package.json at or above ${directory}`);
    }
    current = parent;
  }
  return current;
}

async function scanFile(file: string): Promise<Map<ConformanceRule, number>> {
  const text = await Bun.file(file).text();
  return file.endsWith(".css")
    ? scanStylesheet(text)
    : scanModule(text, file.endsWith(".tsx"));
}

/**
 * Every violation under `directory` (and `options.also`), plus the
 * package's index.html, counted per rule and file. Test files, `e2e`,
 * fixtures and generated code are skipped.
 */
export async function scanConformance(
  directory: string,
  options: ConformanceOptions = {},
): Promise<ConformanceCount[]> {
  const root = options.root ?? (await packageRootOf(directory));
  const directories = [
    directory,
    ...(options.also ?? []).map((extra) => path.join(directory, extra)),
  ];
  const files = new Set<string>();
  for (const scanned of directories) {
    for (const file of await sourceFiles(scanned)) files.add(file);
  }
  const results: ConformanceCount[] = [];
  for (const file of [...files].toSorted((a, b) => a.localeCompare(b))) {
    const relative = path.relative(root, file).split(path.sep).join("/");
    for (const [rule, amount] of await scanFile(file)) {
      results.push({ rule, file: relative, count: amount });
    }
  }
  const indexHtml = Bun.file(path.join(root, "index.html"));
  const themeColor = (await indexHtml.exists())
    ? scanIndexHtml(await indexHtml.text())
    : 0;
  if (themeColor > 0) {
    results.push({
      rule: "theme-color",
      file: "index.html",
      count: themeColor,
    });
  }
  return results.toSorted(
    (a, b) => a.file.localeCompare(b.file) || a.rule.localeCompare(b.rule),
  );
}

function key(rule: string, file: string): string {
  return `${rule} ${file}`;
}

/**
 * Compares the scan with the allowlist and returns one message per
 * difference; an empty list passes. Counts are exact both ways.
 */
export async function checkConformance(
  directory: string,
  allowlist: readonly AllowlistEntry[],
  options: ConformanceOptions = {},
): Promise<string[]> {
  const problems: string[] = [];
  const allowed = new Map<string, AllowlistEntry>();
  for (const entry of allowlist) {
    if (!(entry.rule in CONFORMANCE_RULES)) {
      problems.push(`Unknown rule "${entry.rule}" for ${entry.file}.`);
    }
    if (entry.reason.trim() === "") {
      problems.push(`${entry.file} ${entry.rule}: give a reason.`);
    }
    allowed.set(key(entry.rule, entry.file), entry);
  }
  const found = await scanConformance(directory, options);
  const seen = new Set<string>();
  for (const result of found) {
    const id = key(result.rule, result.file);
    seen.add(id);
    const expected = allowed.get(id)?.count ?? 0;
    if (result.count > expected) {
      problems.push(
        `${result.file}: ${String(result.count)} × ${result.rule}, allowlist has ${String(expected)}. ${CONFORMANCE_RULES[result.rule]}`,
      );
    } else if (result.count < expected) {
      problems.push(
        `${result.file}: ${String(result.count)} × ${result.rule}, allowlist has ${String(expected)}. Lower the allowlist entry to ${String(result.count)}.`,
      );
    }
  }
  for (const [id, entry] of allowed) {
    if (!seen.has(id)) {
      problems.push(
        `${entry.file}: no ${entry.rule} left; remove the allowlist entry.`,
      );
    }
  }
  return problems;
}

/**
 * The app-side entry point: scans `directory` against the
 * `conformance-allowlist.json` beside it (an empty list when the file is
 * missing) and returns the differences. An app's whole test is
 * `expect(await conformanceProblems(import.meta.dirname)).toEqual([])`.
 */
export async function conformanceProblems(
  directory: string,
  options: ConformanceOptions = {},
): Promise<string[]> {
  const file = Bun.file(path.join(directory, ALLOWLIST_FILE));
  const allowlist = (await file.exists())
    ? AllowlistSchema.parse(await file.json())
    : [];
  return checkConformance(directory, allowlist, options);
}
