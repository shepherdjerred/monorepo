import { describe, expect, test } from "vitest";

import {
  occurrenceId,
  normalizeGeneratorUrl,
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

  test("opening email caps rows and reports local and upstream omissions", () => {
    const alerts = Array.from({ length: 30 }, (_, index) =>
      occurrence({
        id: occurrenceId(`fingerprint-${index.toString()}`, BigInt(index + 1)),
        summary: `Alert ${index.toString()}`,
      }),
    );

    const result = openingEmail(alerts, 7);

    expect(result.htmlBody.match(/<li>/gu)).toHaveLength(25);
    expect(result.htmlBody).toContain(
      "5 additional accepted alerts were omitted from this email.",
    );
    expect(result.htmlBody).toContain(
      "Alertmanager omitted 7 additional alerts from this webhook delivery.",
    );
    expect(result.htmlBody).not.toContain("Alert 29");
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

  test("accepts direct Alertmanager snapshots without a generator URL", () => {
    const alert = AlertmanagerSnapshotAlertSchema.parse({
      annotations: {},
      endsAt: "2026-08-08T13:00:00Z",
      fingerprint: "direct-alert",
      labels: { alertname: "DirectAlert" },
      startsAt: "2026-08-08T12:00:00Z",
      status: {
        inhibitedBy: [],
        silencedBy: [],
        state: "active",
      },
    });

    expect(alert.generatorURL).toBeUndefined();
    expect(normalizeGeneratorUrl(alert.generatorURL)).toBeNull();
  });
});
