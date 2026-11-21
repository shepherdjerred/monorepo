/**
 * Display names for the subscription providers Brim reports. Anything else,
 * including the tools the Mac meters, is humanized from its id.
 */
const PROVIDER_LABELS: ReadonlyMap<string, string> = new Map([
  ["claude-code", "Claude Code"],
  ["codex", "Codex"],
  ["antigravity", "Antigravity"],
  ["cursor", "Cursor"],
  ["grok", "Grok"],
  ["kimi", "Kimi"],
  ["muse", "Muse"],
]);

const NUMBER_WORDS: ReadonlyMap<string, string> = new Map(
  [
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "eleven",
    "twelve",
  ].map((word, index) => [word, String(index + 1)]),
);
const UNIT_WORDS: ReadonlySet<string> = new Set([
  "minute",
  "hour",
  "day",
  "week",
  "month",
]);
const PERIOD_WORDS: ReadonlySet<string> = new Set([
  "hourly",
  "daily",
  "weekly",
  "monthly",
  "yearly",
]);
/** Brim's shorthand that does not read as a word. */
const WORD_ALIASES: ReadonlyMap<string, string> = new Map([
  ["3p", "third-party"],
]);
/** An id made only of these says nothing; the window's kind names it. */
const GENERIC_WORDS: ReadonlySet<string> = new Set([
  "window",
  "quota",
  "usage",
  "limit",
]);
/**
 * Kinds that add nothing beside the id: a rolling window's id carries its
 * length, a model-scoped one its model, and a provider-defined one its name.
 */
const SILENT_KINDS: ReadonlySet<string> = new Set([
  "rolling",
  "modelScoped",
  "providerDefined",
]);

/** Lower-case words of a kebab, snake or camel case id. */
function words(value: string): string[] {
  return value
    .replaceAll(/([a-z\d])([A-Z])/gu, "$1 $2")
    .toLowerCase()
    .split(/[\s_-]+/u)
    .filter((word) => word !== "");
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A provider's or tool's display name; an unknown one is title-cased. */
export function providerLabel(provider: string): string {
  const known = PROVIDER_LABELS.get(provider);
  if (known !== undefined) return known;
  const title = words(provider).map((word) => capitalize(word));
  return title.length === 0 ? provider : title.join(" ");
}

type Period = { readonly text: string; readonly length: number };

/** The period that starts at `index`: `five hour`, `5 hour`, `5h` or `weekly`. */
function periodAt(
  tokens: readonly string[],
  index: number,
): Period | undefined {
  const token = tokens[index] ?? "";
  const next = tokens[index + 1];
  const count =
    NUMBER_WORDS.get(token) ?? (/^\d+$/u.test(token) ? token : undefined);
  if (count !== undefined && next !== undefined && UNIT_WORDS.has(next))
    return { text: `${count}-${next}`, length: 2 };
  if (/^\d+[mhdw]$/u.test(token)) return { text: token, length: 1 };
  return PERIOD_WORDS.has(token)
    ? { text: capitalize(token), length: 1 }
    : undefined;
}

/** Runs of plain words become one phrase; each period stands on its own. */
function segments(tokens: readonly string[]): string[] {
  const parts: string[] = [];
  let phrase: string[] = [];
  let index = 0;
  while (index < tokens.length) {
    const period = periodAt(tokens, index);
    if (period === undefined) {
      const token = tokens[index] ?? "";
      phrase.push(WORD_ALIASES.get(token) ?? token);
      index += 1;
      continue;
    }
    if (phrase.length > 0) parts.push(capitalize(phrase.join(" ")));
    phrase = [];
    parts.push(period.text);
    index += period.length;
  }
  if (phrase.length > 0) parts.push(capitalize(phrase.join(" ")));
  return parts;
}

/** The id's words without the provider's own name in front of them. */
function withoutProvider(
  tokens: readonly string[],
  provider: string,
): readonly string[] {
  const prefix = words(provider);
  return prefix.every((word, index) => tokens[index] === word)
    ? tokens.slice(prefix.length)
    : tokens;
}

export type QuotaWindowName = {
  readonly provider: string;
  readonly windowId: string;
  readonly windowKind: string;
};

/**
 * The parts of a quota window's label, read from its id with the provider's
 * prefix dropped: `antigravity-gemini-5h` is `Gemini` and `5h`, `five-hour`
 * is `5-hour`. The kind joins them only when it says something the id does
 * not, such as `weekly` on `codex-secondary-window`.
 */
export function windowLabelParts({
  provider,
  windowId,
  windowKind,
}: QuotaWindowName): string[] {
  const tokens = withoutProvider(words(windowId), provider);
  // The collector sends the id as the kind when Brim reported no kind.
  const kind =
    windowKind === windowId ? "" : capitalize(words(windowKind).join(" "));
  if (tokens.every((token) => GENERIC_WORDS.has(token))) {
    const named = [kind, ...tokens].filter((part) => part !== "").join(" ");
    return [named === "" ? windowId : capitalize(named)];
  }
  const parts = segments(tokens);
  const said = parts.some((part) =>
    part.toLowerCase().includes(kind.toLowerCase()),
  );
  return kind === "" || said || SILENT_KINDS.has(windowKind)
    ? parts
    : [...parts, kind];
}

/** A quota window's label as the table shows it, e.g. `Gemini · 5h`. */
export function windowLabel(name: QuotaWindowName): string {
  return windowLabelParts(name).join(" · ");
}

/** The accessible name of a window's meter. */
export function quotaMeterName(name: QuotaWindowName): string {
  return `${providerLabel(name.provider)} ${windowLabelParts(name).join(" ")} quota used`;
}
