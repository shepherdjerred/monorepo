import { describe, expect, it } from "vitest";
import {
  getOpsSnapshotRuleGroups,
  OPS_SNAPSHOT_SOURCE_STALE_SECONDS,
  OPS_SNAPSHOT_STALE_SECONDS,
} from "./ops-snapshot.ts";

function rule(name: string) {
  const found = getOpsSnapshotRuleGroups()
    .flatMap((group) => group.rules ?? [])
    .find((candidate) => candidate.alert === name);
  if (found === undefined) {
    throw new Error(`expected ${name} rule`);
  }
  return found;
}

describe("ops snapshot freshness rules", () => {
  it("fires when the snapshot stops publishing or was never published", () => {
    const stale = rule("OpsSnapshotStale");

    expect(OPS_SNAPSHOT_STALE_SECONDS).toBe(1800);
    expect(stale.expr.value).toContain(
      "time() - max(ops_snapshot_published_timestamp_seconds) > 1800",
    );
    expect(stale.expr.value).toContain(
      "absent(ops_snapshot_published_timestamp_seconds)",
    );
    expect(stale.labels?.["severity"]).toBe("warning");
  });

  it("alerts per source rather than once for all sources", () => {
    const sourceStale = rule("OpsSnapshotSourceStale");

    expect(OPS_SNAPSHOT_SOURCE_STALE_SECONDS).toBe(3600);
    expect(sourceStale.expr.value).toBe(
      "time() - max by (source) (ops_snapshot_source_last_success_timestamp_seconds) > 3600",
    );
    expect(sourceStale.labels?.["severity"]).toBe("warning");
  });

  it("escapes label templates for Helm", () => {
    const sourceStale = rule("OpsSnapshotSourceStale");

    expect(sourceStale.annotations?.["summary"]).toContain(
      '{{ "{{" }} $labels.source {{ "}}" }}',
    );
  });
});
