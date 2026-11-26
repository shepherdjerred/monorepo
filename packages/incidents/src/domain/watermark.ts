/**
 * Per-signal observation watermarks. Each producer key (`source`, `key`)
 * remembers the newest observation it accepted and the state it reported,
 * independently of any incident, so a retried or delayed report can never
 * recreate or resolve an incident against newer evidence, even after the
 * incident it belonged to has closed.
 *
 * Ordering rules, for a report observed at `t` against a watermark at `w`:
 * - `t < w`: stale; ignored and nothing is written.
 * - `t > w`: accepted; the watermark moves to `t` and the reported state,
 *   including when the state repeats (repeats stay off the timeline).
 * - `t = w`, same state: a duplicate delivery; ignored, nothing is written.
 * - `t = w`, different state: firing wins. A firing report at the
 *   watermark's instant replaces a clear; a clear at a firing watermark's
 *   instant is ignored. The outcome is the same in either arrival order, and
 *   a tie never closes an incident.
 */
import type { z } from "zod";
import type { IncidentSignalInputSchema } from "#shared/contract.ts";

/** The fields of a signal report that order it. */
type Report = Pick<
  z.output<typeof IncidentSignalInputSchema>,
  "source" | "key" | "firing" | "observedAt"
>;

export type SignalObservation = {
  readonly source: Report["source"];
  readonly key: string;
  readonly lastObservedAt: Date;
  readonly firing: boolean;
};

/** A stored watermark; `revision` guards its compare-and-set. */
export type SignalWatermark = SignalObservation & { readonly revision: number };

export type Admission =
  | {
      readonly admitted: false;
      readonly reason: "out of order" | "duplicate" | "tie: firing wins";
    }
  | { readonly admitted: true; readonly observation: SignalObservation };

export function admitObservation(
  signal: Report,
  watermark: SignalWatermark | null,
): Admission {
  const observedAt = new Date(signal.observedAt);
  const observation: SignalObservation = {
    source: signal.source,
    key: signal.key,
    lastObservedAt: observedAt,
    firing: signal.firing,
  };
  if (watermark === null) return { admitted: true, observation };
  const at = observedAt.getTime();
  const mark = watermark.lastObservedAt.getTime();
  if (at < mark) return { admitted: false, reason: "out of order" };
  if (at > mark) return { admitted: true, observation };
  if (signal.firing === watermark.firing)
    return { admitted: false, reason: "duplicate" };
  return signal.firing
    ? { admitted: true, observation }
    : { admitted: false, reason: "tie: firing wins" };
}
