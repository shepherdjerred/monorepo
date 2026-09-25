import { scoutQlLanguageReference } from "#src/reports/ai/scoutql-tools.ts";

/**
 * The ScoutQL reference as Explore reads it: compact text, not JSON.
 *
 * Generated from the same catalog as the report agent's JSON reference, so
 * nothing here can drift from the language. Three things make it about a
 * quarter of the JSON's size:
 *
 * - One line per column. The JSON repeated every field name and flag on
 *   every column, which was about 40% of the whole reference.
 * - Sources Explore may never query are left out: the competition and rank
 *   sources need one server's competition id. So are report presets, and
 *   the idioms, which the field guide already carries as worked examples.
 * - `player_groups` and `match_pairs` are written as differences from
 *   `match_participants` rather than 70 or 100 repeated columns.
 *
 * It sits in Explore's system prompt, not a skill. Loaded mid-turn it landed
 * after the user's question, where no two turns share a prefix, so every turn
 * paid for ~30k uncached tokens; in the system prompt it is one cached prefix.
 */

const EXPLORE_EXCLUDED_SOURCES = new Set([
  "competition_match_participants",
  "competition_rank",
  "rank_current",
]);

type Reference = ReturnType<typeof scoutQlLanguageReference>;
type Source = Reference["sources"][number];
type Column = Source["columns"][number];
type LanguageFunction = Reference["aggregateFunctions"][number];

const CLAUSE_LETTER = { select: "S", where: "W", group_by: "G" } as const;

function columnLine(column: Column): string {
  const clauses = column.usableIn
    .map((clause) => CLAUSE_LETTER[clause])
    .join("");
  return `- ${column.name} ${column.type} [${clauses}] ${column.description}`;
}

function sourceHeader(source: Source): string {
  const facts = [
    source.timeColumn === null
      ? "no time column"
      : `time: ${source.timeColumn}`,
    ...(source.supportsPlayerReference ? ["player('…') allowed"] : []),
    ...(source.supportsGroupCall ? ["GROUP BY group(n|all)"] : []),
  ];
  return `### ${source.id} — ${source.description} (${facts.join("; ")})`;
}

/** Sources whose columns are match_participants', with differences. */
const DERIVED_SOURCES = new Set(["player_groups", "match_pairs"]);

/**
 * A source's columns, or, for a derived source, how they differ from a base.
 *
 * player_groups' columns are the base's, differing only in where they may
 * appear (game-level columns are filter-only; member counters are summed and
 * select-only). Listing names by clause set says that in a few lines; a column
 * whose type or description also differs keeps its own line. match_pairs has
 * every base column unchanged, which is left unsaid, plus its own.
 */
function sourceBody(source: Source, base: Source | undefined): string[] {
  if (base === undefined || !DERIVED_SOURCES.has(source.id)) {
    return source.columns.map((column) => columnLine(column));
  }
  const baseByName = new Map(
    base.columns.map((column) => [column.name, column]),
  );
  const sourceNames = new Set(source.columns.map((column) => column.name));
  const missing = base.columns
    .map((column) => column.name)
    .filter((name) => !sourceNames.has(name));
  const byClauses = new Map<string, string[]>();
  const own: Column[] = [];
  for (const column of source.columns) {
    const inBase = baseByName.get(column.name);
    if (
      inBase?.type !== column.type ||
      inBase.description !== column.description
    ) {
      own.push(column);
      continue;
    }
    const clauses = column.usableIn
      .map((clause) => CLAUSE_LETTER[clause])
      .join("");
    const baseClauses = inBase.usableIn
      .map((clause) => CLAUSE_LETTER[clause])
      .join("");
    if (clauses === baseClauses) continue;
    byClauses.set(clauses, [...(byClauses.get(clauses) ?? []), column.name]);
  }
  return [
    missing.length === 0
      ? `Columns are ${base.id}'s, described above, plus:`
      : `Columns are ${base.id}'s, described above, except: no ${missing.join(", ")}.`,
    ...[...byClauses.entries()].map(
      ([clauses, names]) => `[${clauses}] ${names.join(", ")}`,
    ),
    ...own.map((column) => columnLine(column)),
  ];
}

function functionLine(fn: LanguageFunction): string {
  const accepts = [
    ...(fn.acceptsStar ? ["*"] : []),
    ...(fn.acceptsDistinct ? ["DISTINCT"] : []),
    ...(fn.acceptsFilter ? ["FILTER"] : []),
  ];
  const suffix = accepts.length === 0 ? "" : ` (accepts ${accepts.join(", ")})`;
  return `- ${fn.signatures.join(" | ")} → ${fn.resultType}${suffix}. ${fn.doc}`;
}

export function exploreScoutQlReference(): string {
  const reference = scoutQlLanguageReference();
  const sources = reference.sources.filter(
    (source) => !EXPLORE_EXCLUDED_SOURCES.has(source.id),
  );
  const base = sources.find((source) => source.id === "match_participants");
  return [
    "## ScoutQL reference",
    "Columns read `name type [clauses] description`; clauses are S (SELECT), W (WHERE), G (GROUP BY).",
    ...sources.flatMap((source) => [
      sourceHeader(source),
      ...sourceBody(source, base),
    ]),
    "### Aggregate functions",
    ...reference.aggregateFunctions.map((fn) => functionLine(fn)),
    "### Scalar functions",
    ...reference.scalarFunctions.map((fn) => functionLine(fn)),
    "### Macros",
    ...reference.macroFunctions.map((fn) => functionLine(fn)),
    "### References",
    ...reference.referenceFunctions.map((fn) => functionLine(fn)),
    "### RENDER kinds",
    ...reference.renderKinds.map(
      (kind) =>
        `- ${kind.id}${kind.isChart ? " (chart)" : ""}: ${kind.description}`,
    ),
    `Chart options: ${reference.renderOptions.join(", ")}.`,
    `### Queues: ${reference.queues.map((queue) => `${queue.id} (${queue.label})`).join(", ")}.`,
  ].join("\n");
}
