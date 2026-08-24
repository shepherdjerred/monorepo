import { SCOUTQL_IDIOMS } from "@scout-for-lol/data/model/scoutql/scoutql-idioms.ts";

/**
 * The one ScoutQL authoring guide, shared verbatim by both agents.
 *
 * 99% of the ScoutQL ever written is written by a model, so this section is
 * the language's primary authoring surface rather than a summary of it. It
 * exists as a single module for one reason: a rule that says one thing in the
 * Explore prompt and another in the report-editor prompt is invisible until a
 * user gets two different answers to the same question. `prompt.test.ts`
 * asserts both prompts contain this exact string.
 *
 * The worked examples are interpolated from `SCOUTQL_IDIOMS` — the same
 * cookbook the docs page, the in-app reference, and editor completions read —
 * so prose and examples cannot fork either. Every idiom compiles; the field
 * guide test re-asserts it here so a prompt example can never become
 * unexecutable text a model faithfully copies.
 */

const PREAMBLE: readonly string[] = [
  "ScoutQL is a bounded subset of DuckDB SQL over Scout's report lake. Clause order is SQL's:",
  "`SELECT <outputs> FROM <source> [WHERE <predicate>] [GROUP BY <keys>] [HAVING <predicate>] [ORDER BY <keys>] [LIMIT <n>] [RENDER <kind> [WITH (<options>)]]`.",
  "Where ScoutQL overlaps SQL it behaves exactly as DuckDB does — single-quoted strings ('' escapes a quote), `::` casts, `INTERVAL`, `--` line comments, and no forgiving special cases. On top of SQL it adds `RENDER … WITH (…)`, `player('…')`, `champion('…')`, `kda()`, and `per_minute(x)`.",
  "There is no metric vocabulary and no implicit aggregation: you select raw lake columns wrapped in ordinary SQL aggregates.",
];

/**
 * The rules a model gets wrong when they are not stated, each with the reason
 * it matters. A rule without its reason gets discarded the first time it is
 * inconvenient, so none of these is a bare imperative.
 */
const HARD_RULES: readonly string[] = [
  '**State a time bound — or say plainly that the answer covers all ingested history.** A query with no time predicate is legal and means every match Scout has ever ingested. That is a real answer, but only when you say so: handing someone lifetime numbers when they asked about "recently" is wrong in a way that looks right. Bound it with `WHERE game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 30 DAY`, or with the calendar form, and name the period you used in the prose.',
  "**Write `AVG(win::INT)`, never `AVG(win)`.** DuckDB refuses to average a BOOLEAN, so the uncast form is an error rather than a slower spelling. The same `::INT` cast makes a rate out of any boolean column (`surrendered`, `first_blood_kill`, …), and it is what turns the value into a percentage instead of a count.",
  "**Aggregate explicitly.** A bare column in SELECT is an error unless it is one of the GROUP BY keys — nothing is summed implicitly. Wrap counters in `SUM(…)`, per-game values in `AVG(…)`, and count rows with `COUNT(*)`. Give every computed output a name (`AS games`); HAVING and ORDER BY can then refer to it.",
  "**Name people with `player('…')` and champions with `champion('…')`.** A Riot ID is a display name: it changes when someone renames and one person often plays several accounts, so `player('Long')` resolves that person's whole set of accounts while a bare string matches only games played under exactly that name. `champion('Jinx')` folds to the numeric id at compile time and suggests a spelling when the name is wrong — never write a raw champion id.",
  "**Put a sample-size floor in HAVING on anything ranked.** `HAVING COUNT(*) >= 10` (or `HAVING games >= 10` once you have aliased the count) keeps a two-game account with a 100% win rate off the top of a leaderboard. WHERE cannot do this: it filters rows, not groups.",
  "**A line or area chart needs a time bucket in GROUP BY.** Use `GROUP BY DATE_TRUNC('week', game_creation_at)` and echo the same expression in SELECT (`AS week`) so the axis has a name to plot and sort by. A line drawn between categories asserts a trend that does not exist — re-sorting the categories would change the shape of the chart without changing a single number. Rank or compare categories with `bar_chart` or `leaderboard` instead.",
  "**Compare periods with `RENDER … WITH (compare = previous_period)`.** It re-runs the same aggregation over the equally long span immediately before the window and overlays the two, which is the only way to line them up correctly. It needs both a stated time bound and a time bucket to compare across.",
  "**Answer a sub-question with `FILTER (WHERE …)`, not a second query.** `COUNT(*) FILTER (WHERE win) AS wins` and `AVG(win::INT) FILTER (WHERE queue = 'solo') AS solo_win_rate` narrow one output without narrowing the query, so wins, losses, and a queue-specific rate all come from a single pass over the same rows.",
];

/** The shared field guide, as a markdown section for a system prompt. */
export function scoutQlFieldGuideSection(): string {
  return [
    "## ScoutQL field guide",
    "",
    ...PREAMBLE,
    "",
    "### Rules",
    "",
    ...HARD_RULES.map((rule, index) => `${String(index + 1)}. ${rule}`),
    "",
    "### Idioms",
    "",
    "Every query below compiles exactly as written. Copy the shape and change the columns.",
    ...SCOUTQL_IDIOMS.flatMap((idiom) => [
      "",
      `#### ${idiom.title}`,
      idiom.description,
      "",
      "```scoutql",
      idiom.query,
      "```",
    ]),
  ].join("\n");
}
