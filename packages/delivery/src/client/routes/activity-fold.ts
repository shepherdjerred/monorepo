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
 * One row of the activity list: a single audit entry, every stage write of
 * one deployment, or the consecutive repeats of one build record, newest
 * first as fetched.
 */
export type ActivityRow =
  | { kind: "entry"; entry: ActivityEntry }
  | { kind: "stages"; entries: [ActivityEntry, ...ActivityEntry[]] }
  | { kind: "repeated"; entries: [ActivityEntry, ...ActivityEntry[]] };

type StageRow = Extract<ActivityRow, { kind: "stages" }>;

/**
 * Routine build records that arrive in bursts, one per service a commit
 * builds; a run of them reads as one row with a count.
 */
export const REPEATED_ACTIONS: ReadonlySet<string> = new Set([
  "build.source_recorded",
  "build.verified",
  "build.published",
]);

/**
 * Fold every stage write of one deployment on the page into one row, where
 * its newest write sits, and each run of one repeated build action by the
 * same actor into one counted row. A deployment's steps are one story however
 * other entries, other deployments or other actors interleave with them, so a
 * step that ran and then succeeded never reads as two rows. Presentational
 * and within one fetched page: a deployment whose writes cross a page
 * boundary reads as one row on each page.
 */
export function foldActivity(entries: readonly ActivityEntry[]): ActivityRow[] {
  const rows: ActivityRow[] = [];
  const stages = new Map<string, StageRow>();
  for (const entry of entries) {
    if (entry.action === STAGE_ACTION) {
      const row = stages.get(entry.entityId);
      if (row === undefined) {
        const created: StageRow = { kind: "stages", entries: [entry] };
        stages.set(entry.entityId, created);
        rows.push(created);
      } else row.entries.push(entry);
      continue;
    }
    const last = rows.at(-1);
    if (!REPEATED_ACTIONS.has(entry.action))
      rows.push({ kind: "entry", entry });
    else if (
      last?.kind === "repeated" &&
      last.entries[0].actor === entry.actor &&
      last.entries[0].action === entry.action
    )
      last.entries.push(entry);
    else rows.push({ kind: "repeated", entries: [entry] });
  }
  return rows;
}

/** How far along a stage's status is: a terminal status follows `running`. */
function progress(status: string) {
  return status === "running" ? 0 : 1;
}

/**
 * Each stage of a run once, at the state its newest write gave it: a stage
 * written `running` and then `succeeded` reads only as succeeded. Two writes
 * recorded in the same instant have no order but their progress, so the
 * later status wins. Newest first, as the run was fetched, each stage where
 * its first write sits.
 */
export function latestStages(
  entries: readonly ActivityEntry[],
): { entry: ActivityEntry; stage: string; status: string; writes: number }[] {
  const latest = new Map<
    string,
    { entry: ActivityEntry; stage: string; status: string; writes: number }
  >();
  for (const entry of entries) {
    const recorded = StageActivitySchema.parse(entry.metadata);
    const seen = latest.get(recorded.stage);
    if (seen === undefined)
      latest.set(recorded.stage, { entry, ...recorded, writes: 1 });
    else {
      seen.writes += 1;
      if (
        seen.entry.occurredAt === entry.occurredAt &&
        progress(recorded.status) > progress(seen.status)
      ) {
        seen.entry = entry;
        seen.status = recorded.status;
      }
    }
  }
  return [...latest.values()];
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
