import { z } from "zod";
import {
  validateCapture,
  recordKey,
} from "#migration/capture/capture-validation.ts";
import { snapshotHash } from "./profile-import.ts";

/** Missing records are deletion evidence only in complete, stable captures of the same instance. */
export function compareCaptures(beforeValue: unknown, afterValue: unknown) {
  const before = validateCapture(beforeValue);
  const after = validateCapture(afterValue);
  if (
    before.snapshot.sourceInstanceId !== after.snapshot.sourceInstanceId ||
    before.snapshot.sourceKind !== after.snapshot.sourceKind
  )
    throw new Error("Cannot compare different source instances");
  if (
    Date.parse(after.snapshot.startedAt) <
    Date.parse(before.snapshot.completedAt)
  )
    throw new Error("Final capture must start after the baseline completes");
  const previous = new Map(
    before.snapshot.records.map((record) => [
      recordKey(before.snapshot, record),
      snapshotHash(z.json().parse(record)),
    ]),
  );
  const current = new Map(
    after.snapshot.records.map((record) => [
      recordKey(after.snapshot, record),
      snapshotHash(z.json().parse(record)),
    ]),
  );
  const reliable =
    before.complete && before.stable && after.complete && after.stable;
  const keys = [...new Set([...previous.keys(), ...current.keys()])].sort();
  return {
    schemaVersion: 1,
    beforeHash: before.captureHash,
    afterHash: after.captureHash,
    reliable,
    requiresReview:
      !reliable || keys.some((key) => previous.get(key) !== current.get(key)),
    mayTransferOwnership: false,
    entries: keys.map((key) => ({
      provenanceKey: key,
      change: current.has(key)
        ? previous.has(key)
          ? previous.get(key) === current.get(key)
            ? "unchanged"
            : "changed"
          : "added"
        : reliable
          ? "removed"
          : "absence_unproven",
      protected: !reliable || previous.get(key) !== current.get(key),
    })),
  };
}
