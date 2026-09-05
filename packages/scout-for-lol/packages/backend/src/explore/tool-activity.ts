import { z } from "zod";
import { EXPLORE_ACTIVITY_MAX_LENGTH } from "@scout-for-lol/data";
import { scoutQlSourceCatalog } from "@scout-for-lol/data/model/scoutql/catalog-columns.ts";
import type { ExploreToolResultInspection } from "#src/explore/tool-inspection.ts";

/**
 * The owner-only live status strings.
 *
 * **Nothing in this file may be returned from `toolCallMessage` /
 * `toolResultMessage` in `stream.ts`, or assigned to any `ExploreTraceEntry`
 * field.** Those strings are persisted into a message's trace and served
 * unauthenticated to anyone holding a share link, which is why they are as
 * vague as they are. The strings here travel only on the ephemeral `activity`
 * event, which is never stored and never shared, so they may name the player
 * being looked up or the number of rows a query scanned.
 *
 * That separation is the whole point of this module existing rather than these
 * functions living next to their generic counterparts, where a copy-paste
 * between the two would look unremarkable in review.
 *
 * Three invariants, each with a test:
 *
 * - **Never throws.** Every read of tool input or output is a `safeParse` with
 *   a fallback to the generic phrase. `inspectExploreToolCall` uses `.parse`
 *   and a throw there ends the turn; status text is decoration and must
 *   degrade, never escalate.
 * - **Never returns an empty string.** The wire schema requires `min(1)`, and
 *   the SSE writer validates each frame inside the subscriber callback that
 *   broadcast wraps in a `try`/`catch` which drops the subscriber — so an
 *   empty string does not error visibly, it silently detaches that browser.
 * - **Always clamped** to `EXPLORE_ACTIVITY_MAX_LENGTH`, for the same reason.
 */

/** Collapse whitespace and bound the length, always returning something. */
function clampActivity(text: string, fallback: string): string {
  const collapsed = text.replaceAll(/\s+/gu, " ").trim();
  if (collapsed.length === 0) {
    return fallback;
  }
  return collapsed.length <= EXPLORE_ACTIVITY_MAX_LENGTH
    ? collapsed
    : `${collapsed.slice(0, EXPLORE_ACTIVITY_MAX_LENGTH - 1)}…`;
}

/** Readable at a glance: exact below ten thousand, compact above. */
function compactCount(value: number): string {
  if (!Number.isFinite(value) || value < 0) {
    return "0";
  }
  const whole = Math.floor(value);
  return whole < 10_000
    ? whole.toLocaleString("en-US")
    : new Intl.NumberFormat("en-US", {
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(whole);
}

/**
 * Name the table a query reads without echoing any of the query.
 *
 * The token found after `FROM` is used only to *look up* an entry in the
 * closed source catalog, and it is the catalog's own id that gets emitted —
 * never the text from the query. So no substring the model authored can reach
 * the status line, and there is nothing here that could need truncating. An
 * unrecognised token simply yields the generic phrase.
 */
function querySourceLabel(queryText: string): string | null {
  const match = /\bfrom\s+(\w+)/iu.exec(queryText);
  const token = match?.[1];
  if (token === undefined) {
    return null;
  }
  const catalog = scoutQlSourceCatalog(token.toLowerCase());
  return catalog === undefined ? null : catalog.id.replaceAll("_", " ");
}

const QueryInputSchema = z.looseObject({ queryText: z.string() });
const PlayerQueryInputSchema = z.looseObject({ query: z.string() });
const PlayerResultSchema = z.looseObject({
  candidates: z.array(z.unknown()),
});
const ExecutionResultSchema = z.looseObject({
  rowsReturned: z.number().nullable(),
  rowsScanned: z.number().nullable(),
});

/**
 * The moment the model names a tool, before its arguments have arrived.
 *
 * Nothing but the tool name is known yet, so this is exactly the generic
 * phrase — it simply lands a beat earlier than it used to. The
 * argument-derived phrase replaces it at `tool-call`.
 */
export function toolStartActivity(genericMessage: string): string {
  return clampActivity(genericMessage, "Working…");
}

/** What the turn is about to do, given the arguments it will do it with. */
export function toolCallActivity(
  toolName: string,
  input: unknown,
  genericMessage: string,
): string {
  const fallback = clampActivity(genericMessage, "Working…");
  if (toolName === "resolve_player") {
    const parsed = PlayerQueryInputSchema.safeParse(input);
    return parsed.success
      ? clampActivity(`Finding “${parsed.data.query}”`, fallback)
      : fallback;
  }
  if (toolName === "run_report_query" || toolName === "validate_report_query") {
    const parsed = QueryInputSchema.safeParse(input);
    if (!parsed.success) {
      return fallback;
    }
    const source = querySourceLabel(parsed.data.queryText);
    if (source === null) {
      return fallback;
    }
    return clampActivity(
      toolName === "run_report_query"
        ? `Querying ${source}`
        : `Checking a query over ${source}`,
      fallback,
    );
  }
  return fallback;
}

function playerResultActivity(
  input: unknown,
  inspection: ExploreToolResultInspection,
  fallback: string,
): string {
  // `inspectExploreToolResult` has no branch for this tool, so its output is
  // read here rather than taken from the inspection.
  const query = PlayerQueryInputSchema.safeParse(input);
  const result = PlayerResultSchema.safeParse(inspection.rawOutput);
  if (!query.success || !result.success) {
    return fallback;
  }
  const count = result.data.candidates.length;
  const plural = count === 1 ? "" : "es";
  return clampActivity(
    count === 0
      ? `No player matches “${query.data.query}”`
      : `Found ${compactCount(count)} match${plural} for “${query.data.query}”`,
    fallback,
  );
}

function queryResultActivity(
  inspection: ExploreToolResultInspection,
  fallback: string,
): string {
  // Numbers and nothing else: `rowsScanned` and `rowsReturned` are computed by
  // the query engine, so this is the high-information half of the status line
  // with none of the risk of echoing query text.
  const details = inspection.details;
  if (details?.kind !== "execution") {
    return fallback;
  }
  const parsed = ExecutionResultSchema.safeParse(details);
  if (!parsed.success || parsed.data.rowsScanned === null) {
    return fallback;
  }
  const { rowsScanned, rowsReturned } = parsed.data;
  return clampActivity(
    rowsReturned === null || rowsReturned === 0
      ? `Scanned ${compactCount(rowsScanned)} rows, none matched`
      : `Scanned ${compactCount(rowsScanned)} rows, kept ${compactCount(rowsReturned)}`,
    fallback,
  );
}

/** What the turn just learned, in numbers the engine already computed. */
export function toolResultActivity(
  toolName: string,
  input: unknown,
  inspection: ExploreToolResultInspection,
  genericMessage: string,
): string {
  const fallback = clampActivity(genericMessage, "Done.");
  if (!inspection.succeeded) {
    return fallback;
  }
  if (toolName === "resolve_player") {
    return playerResultActivity(input, inspection, fallback);
  }
  if (toolName === "run_report_query") {
    return queryResultActivity(inspection, fallback);
  }
  return fallback;
}
