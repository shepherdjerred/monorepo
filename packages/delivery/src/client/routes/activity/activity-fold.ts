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

/**
 * Routine build records that arrive in bursts, one per service a commit
 * builds; a run of them reads as one row with a count.
 */
export const REPEATED_ACTIONS: ReadonlySet<string> = new Set([
  "build.source_recorded",
  "build.verified",
  "build.published",
]);

/** The unit separator keeps the parts of a key from running together. */
const SEPARATOR = "\u{1F}";

/**
 * Actions that one actor records over and over about one thing: an executor
 * checking in on a deployment while it runs, Delivery asking again for the
 * same worker's retirement in one environment. Every repeat on the page is
 * one counted row where the newest sits, however other entries interleave,
 * keyed by what makes two of them the same repeat.
 */
const GROUPED_ACTIONS: ReadonlyMap<string, (entry: ActivityEntry) => string> =
  new Map([
    [
      "deployment.lease_renewed",
      (entry) => [entry.actor, entry.entityId].join(SEPARATOR),
    ],
    [
      "worker.retirement_requested",
      (entry) =>
        [entry.actor, entry.subject?.environmentId ?? "", entry.entityId].join(
          SEPARATOR,
        ),
    ],
  ]);

/** The count of a folded run with what it counts: "3 check-ins", "2 builds". */
export function repeatCount(action: string, count: number) {
  const nouns: Record<string, [string, string]> = {
    "deployment.lease_renewed": ["check-in", "check-ins"],
    "worker.retirement_requested": ["request", "requests"],
  };
  const [one, many] =
    nouns[action] ??
    (action.startsWith("build.") ? ["build", "builds"] : ["entry", "entries"]);
  return `${String(count)} ${count === 1 ? one : many}`;
}

/** The rows that gather their entries from anywhere on the page. */
type JoinedRow = Exclude<ActivityRow, { kind: "entry" }>;

/**
 * Where an entry that gathers with its kin goes: a stage write joins its
 * deployment's steps, a grouped action its repeats. Null for any other entry.
 */
function joining(entry: ActivityEntry) {
  if (entry.action === STAGE_ACTION)
    return { kind: "stages", key: entry.entityId } as const;
  const key = GROUPED_ACTIONS.get(entry.action)?.(entry);
  return key === undefined ? null : ({ kind: "repeated", key } as const);
}

/**
 * Fold every stage write of one deployment on the page into one row, where
 * its newest write sits, each repeat of a grouped action (see
 * `GROUPED_ACTIONS`) likewise, and each run of one repeated build action by
 * the same actor into one counted row. A deployment's steps are one story
 * however other entries, other deployments or other actors interleave with
 * them, so a step that ran and then succeeded never reads as two rows.
 * Presentational and within one fetched page: a deployment whose writes cross
 * a page boundary reads as one row on each page.
 */
export function foldActivity(entries: readonly ActivityEntry[]): ActivityRow[] {
  const rows: ActivityRow[] = [];
  const joined = new Map<string, JoinedRow>();
  for (const entry of entries) {
    const target = joining(entry);
    if (target !== null) {
      const id = [target.kind, target.key].join(SEPARATOR);
      const row = joined.get(id);
      if (row === undefined) {
        const created: JoinedRow = { kind: target.kind, entries: [entry] };
        joined.set(id, created);
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
