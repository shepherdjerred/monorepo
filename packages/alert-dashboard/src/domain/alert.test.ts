import { describe, expect, test } from "bun:test";

import {
  occurrenceId,
  openingEmail,
  severityFromLabels,
  suppressionFromSnapshot,
  type AlertOccurrenceRecord,
} from "#domain/alert";
import { AlertOccurrenceRecordSchema } from "#domain/alert";
import { AlertmanagerSnapshotAlertSchema } from "#shared/schema";

function occurrence(
  overrides: Partial<AlertOccurrenceRecord> = {},
): AlertOccurrenceRecord {
  return AlertOccurrenceRecordSchema.parse({
    id: occurrenceId("fingerprint", 1n),
    source: "alertmanager",
    fingerprint: "fingerprint",
    startedAtNs: 1n,
    openedAtNs: 1n,
    resolvedAtNs: null,
    lastSeenAtNs: 1n,
    missingSinceNs: null,
    absentSnapshots: 0,
    firstNotifiedAtNs: 1n,
    lifecycleState: "open",
    suppressionState: "none",
    resolutionSource: null,
    alertname: "DiskFull",
    namespace: "storage",
    severity: "critical",
    summary: "Disk <almost> full",
    generatorUrl: null,
    labels: { alertname: "DiskFull", severity: "critical" },
    annotations: {},
    ...overrides,
  });
}

describe("alert domain", () => {
  test("occurrence identity includes fingerprint and start instant", () => {
    expect(occurrenceId("same", 10n)).toBe(occurrenceId("same", 10n));
    expect(occurrenceId("same", 10n)).not.toBe(occurrenceId("same", 11n));
    expect(occurrenceId("same", 10n)).not.toBe(occurrenceId("other", 10n));
  });

  test("opening email groups alerts and escapes external metadata", () => {
    const result = openingEmail([
      occurrence(),
      occurrence({ id: occurrenceId("second", 2n), severity: "warning" }),
    ]);
    expect(result.subject).toBe("[Alerts] 2 critical alerts opened");
    expect(result.htmlBody).toContain("Disk &lt;almost&gt; full");
    expect(result.htmlBody).toContain("alerts.tailnet-1a49.ts.net");
  });

  test("unknown severities stay explicit", () => {
    expect(severityFromLabels({ severity: "page-me" })).toBe("unknown");
  });

  test("silence takes precedence over inhibition", () => {
    const alert = AlertmanagerSnapshotAlertSchema.parse({
      annotations: {},
      endsAt: "2026-08-08T13:00:00Z",
      fingerprint: "abc",
      generatorURL: "",
      labels: {},
      startsAt: "2026-08-08T12:00:00Z",
      status: {
        inhibitedBy: ["inhibition"],
        silencedBy: ["silence"],
        state: "suppressed",
      },
    });
    expect(suppressionFromSnapshot(alert)).toBe("silenced");
  });
});
