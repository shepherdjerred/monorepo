import { AsyncLocalStorage } from "node:async_hooks";
import { z } from "zod";
import type { Db } from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";
import {
  scoutDurableDualwriteFailuresTotal,
  scoutDurableDualwriteRecordsTotal,
} from "#src/metrics/durable.ts";

/**
 * The fail-open boundary every durable dual-write goes through.
 *
 * This wave makes Postgres the operational RECORD of what the v1 pipeline
 * does, while v1 remains authoritative for behaviour. That asymmetry is the
 * whole contract of this module: a durable write that throws must never reach
 * the pipeline, because the pipeline's own error handling is what decides
 * whether a cursor advances or a report is retried. A broken recorder would
 * otherwise be able to block ingestion, which is exactly the failure mode the
 * durable tables exist to remove.
 *
 * Swallowing is not silence. Every failure logs loudly and increments
 * `scout_durable_dualwrite_failures_total{write_kind}`, so parity loss is
 * visible in the place the acceptance checks will look.
 */

const logger = createLogger("durable-dualwrite");

/**
 * Every durable write the bridge performs, spelled out so the metric's
 * `write_kind` label can never grow unbounded. A new dual-write site adds a
 * member here rather than passing a free-form string.
 *
 * `raw-archive` and `lake-staging` are recorded by the receipted lake
 * projection in `report-lake/` rather than by a service in this directory,
 * but they share this list on purpose: one closed vocabulary is what keeps
 * the label bounded and a parity dashboard's `write_kind` axis readable. A
 * second enumeration next to the other producer would be two vocabularies for
 * one metric.
 */
export const DURABLE_WRITE_KINDS = [
  "match-identity",
  "observation",
  "tracked-accounts",
  "cursor-advanced",
  "raw-archive",
  "lake-staging",
  "receipt-settlement",
  "receipt-report-delivery",
  "receipt-prematch-delivery",
  "receipt-progression",
  "intent-created",
  "intent-ready",
  "intent-send-started",
  "intent-delivered",
  "intent-failed",
  "workflow-start-requested",
  "workflow-start-accepted",
] as const;

export type DurableWriteKind = (typeof DURABLE_WRITE_KINDS)[number];

/**
 * The answers the durable repositories give. Parsed rather than trusted so a
 * repository that grows a new outcome shows up as a loud dual-write failure
 * instead of quietly widening a Prometheus label.
 */
export type DurableWriteOutcome = z.infer<typeof DurableWriteOutcomeSchema>;
export const DurableWriteOutcomeSchema = z.enum([
  "applied",
  "already-applied",
  "adopted",
  "conflict",
]);

/**
 * What a durable write needs: the database handle to write through, and the
 * clock to stamp facts with. Both are injected so a caller already inside a v1
 * transaction can pass that transaction's client, and so tests can pin time.
 */
export type DurableFacts = {
  readonly db: Db;
  readonly now: () => Date;
};

/**
 * Failures are reported through the log and the metric, never through Sentry.
 *
 * Sentry is where the pipeline's own broken invariants go, and a recorder that
 * cannot reach its tables is not one of those: a durable outage would raise an
 * event per write per channel per match, drowning the errors that actually
 * stop work. `scout_durable_dualwrite_failures_total` is the signal an alert
 * watches, and it stays legible under exactly the outage that produces it.
 */
function reportDurableWriteFailure(
  kind: DurableWriteKind,
  error: unknown,
): void {
  countDurableWriteFailure(kind);
  logger.error(
    `❌ Durable dual-write ${kind} failed; the authoritative v1 pipeline continues unaffected`,
    error,
  );
}

/**
 * Count one THROWN durable write. Separated from the log so a producer with
 * more context to report — the receipted lake projection names the receipt and
 * the match it belongs to — meters through this module rather than reaching
 * for the counter itself.
 */
export function countDurableWriteFailure(kind: DurableWriteKind): void {
  scoutDurableDualwriteFailuresTotal.inc({ write_kind: kind });
}

/**
 * Count one COMPLETED durable write by the repository's own answer, which is
 * parsed here so no producer can widen the `outcome` label by passing a string
 * the bridge does not recognise. A repository that grows a new outcome throws
 * out of here and is counted as that write's failure instead.
 */
export function countDurableWrite(
  kind: DurableWriteKind,
  outcome: string,
): DurableWriteOutcome {
  const parsed = DurableWriteOutcomeSchema.parse(outcome);
  scoutDurableDualwriteRecordsTotal.inc({ write_kind: kind, outcome: parsed });
  return parsed;
}

/**
 * Whether the code running right now is inside a {@link recordDurableWrite}
 * callback.
 *
 * Both this wrapper and the receipted lake projection's own fail-open wrapper
 * increment `scout_durable_dualwrite_records_total`, so a receipt recorded
 * from inside a durable write would count one fact twice and silently inflate
 * the parity signal. The two are sequential everywhere today; this is what
 * makes a future nesting fail instead of drifting the metric.
 *
 * Tracked per async context rather than with a module-level flag because one
 * process handles several matches at once: a shared flag would let one flow's
 * durable write make an unrelated flow's receipt look nested.
 */
const durableWriteScope = new AsyncLocalStorage<true>();

export function insideDurableWrite(): boolean {
  return durableWriteScope.getStore() === true;
}

/**
 * Run one durable write behind the fail-open boundary.
 *
 * `write` returns the repository's own answer, which is what the records
 * counter reports. Identity parsing belongs INSIDE `write` so a malformed v1
 * value is counted as this write's failure rather than escaping to the
 * pipeline.
 */
export async function recordDurableWrite(
  facts: DurableFacts,
  kind: DurableWriteKind,
  write: (db: Db) => Promise<{ outcome: string }>,
): Promise<void> {
  try {
    const result = await durableWriteScope.run(true, () => write(facts.db));
    countDurableWrite(kind, result.outcome);
  } catch (error) {
    reportDurableWriteFailure(kind, error);
  }
}

/**
 * Parse a branded identity out of a looser v1 value behind the same fail-open
 * boundary. `null` means "record nothing for this match": the durable facts
 * are keyed by that identity, so without it there is nothing truthful to
 * write. No record is counted, because resolving an identity is not itself a
 * recorded fact — only the failure is.
 */
export function resolveDurableIdentity<T>(resolve: () => T): T | null {
  try {
    return resolve();
  } catch (error) {
    reportDurableWriteFailure("match-identity", error);
    return null;
  }
}
