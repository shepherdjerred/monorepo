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
  | { kind: "stages"; entries: [ActivityEntry, ...ActivityEntry[]] };

/**
 * Fold each run of consecutive stage writes of the same deployment by the
 * same actor into one row. Presentational and within one fetched page:
 * another action between two stage writes ends the run, and a run that
 * crosses a page boundary reads as one row on each page.
 */
export function foldActivity(entries: readonly ActivityEntry[]): ActivityRow[] {
  const rows: ActivityRow[] = [];
  for (const entry of entries) {
    if (entry.action !== STAGE_ACTION) {
      rows.push({ kind: "entry", entry });
      continue;
    }
    const last = rows.at(-1);
    if (
      last?.kind === "stages" &&
      last.entries[0].entityId === entry.entityId &&
      last.entries[0].actor === entry.actor
    )
      last.entries.push(entry);
    else rows.push({ kind: "stages", entries: [entry] });
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
