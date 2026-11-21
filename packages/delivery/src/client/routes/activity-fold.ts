import { z } from "zod";
import type { ActivityEntry } from "#shared/hub/hub-contract.ts";

/** The audit action an executor's stage write records. */
export const STAGE_ACTION = "deployment.stage";

/** What a stage write's audit row carries: which stage, and what it became. */
export const StageActivitySchema = z.object({
  stage: z.string(),
  status: z.string(),
});

/**
 * One row of the activity list: a single audit entry, or the consecutive
 * stage writes of one deployment by one actor, newest first as fetched.
 */
export type ActivityRow =
  | { kind: "entry"; entry: ActivityEntry }
  | { kind: "stages"; entries: [ActivityEntry, ...ActivityEntry[]] }
  | { kind: "repeated"; entries: [ActivityEntry, ...ActivityEntry[]] };

/**
 * Routine build records that arrive in bursts, one per service a commit
 * builds; a run of them reads as one row with a count.
 */
export const REPEATED_ACTIONS: ReadonlySet<string> = new Set([
  "build.source_recorded",
  "build.verified",
  "build.published",
]);

/** Which run an entry joins: stage writes of one deployment, or one repeated action. */
function runOf(entry: ActivityEntry) {
  if (entry.action === STAGE_ACTION) return "stages" as const;
  return REPEATED_ACTIONS.has(entry.action) ? ("repeated" as const) : null;
}

/** Whether an entry continues a run that began with `first`: same actor, and same deployment or same action. */
function continues(
  first: ActivityEntry,
  run: "stages" | "repeated",
  entry: ActivityEntry,
) {
  if (first.actor !== entry.actor) return false;
  return run === "stages"
    ? first.entityId === entry.entityId
    : first.action === entry.action;
}

/**
 * Fold each run of consecutive stage writes of the same deployment by the
 * same actor into one row, and each run of one repeated build action by the
 * same actor into one counted row. Presentational and within one fetched
 * page: another action between two entries ends the run, and a run that
 * crosses a page boundary reads as one row on each page.
 */
export function foldActivity(entries: readonly ActivityEntry[]): ActivityRow[] {
  const rows: ActivityRow[] = [];
  for (const entry of entries) {
    const run = runOf(entry);
    const last = rows.at(-1);
    if (run === null) rows.push({ kind: "entry", entry });
    else if (
      last !== undefined &&
      last.kind !== "entry" &&
      last.kind === run &&
      continues(last.entries[0], run, entry)
    )
      last.entries.push(entry);
    else rows.push({ kind: run, entries: [entry] });
  }
  return rows;
}

/**
 * The result an action names in its own suffix, for the actions that record
 * a deployment's outcome.
 */
export function outcomeOf(action: string) {
  const outcomes = ["succeeded", "failed", "canceled"] as const;
  return outcomes.find((outcome) => action === `deployment.${outcome}`) ?? null;
}

/**
 * What a request recorded. The audit trail spans every version of the
 * writer, so each field is present only on rows written since it existed.
 */
export const RequestedActivitySchema = z.object({
  environmentId: z.string().optional(),
  versionSetRevisionId: z.string().optional(),
  /** Why the selection was not eligible for an ordinary deploy. */
  override: z.array(z.string()).optional(),
});

/** What an approval decision recorded. */
export const DecisionActivitySchema = z.object({
  override: z.boolean().optional(),
  decidedAtPlan: z.boolean().optional(),
});

/** What a build publication recorded. */
export const PublishedActivitySchema = z.object({
  serviceId: z.string().optional(),
  sourceRevision: z.string().optional(),
});
