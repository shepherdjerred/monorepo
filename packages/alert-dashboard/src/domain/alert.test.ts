import { describe, expect, test } from "vitest";

import {
  labelChanges,
  observedLastSeenAtNs,
  occurrenceId,
  normalizeGeneratorUrl,
  sameStringMap,
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

  test("keeps alerts with relative generator URLs and omits the unusable link", () => {
    const alert = AlertmanagerSnapshotAlertSchema.parse({
      annotations: {},
      endsAt: "2026-08-08T13:00:00Z",
      fingerprint: "relative-generator-url",
      generatorURL: "/explore?left=%7B%22queries%22%3A%5B%5D%7D",
      labels: { alertname: "AlloyUnsupportedGoVersion" },
      startsAt: "2026-08-08T12:00:00Z",
      status: {
        inhibitedBy: [],
        silencedBy: [],
        state: "active",
      },
    });

    expect(normalizeGeneratorUrl(alert.generatorURL)).toBeNull();
  });

  test("rejects malformed nonempty generator URLs", () => {
    expect(() =>
      AlertmanagerSnapshotAlertSchema.parse({
        annotations: {},
        endsAt: "2026-08-08T13:00:00Z",
        fingerprint: "malformed-generator-url",
        generatorURL: "not a URL",
        labels: { alertname: "MalformedGeneratorUrl" },
        startsAt: "2026-08-08T12:00:00Z",
        status: {
          inhibitedBy: [],
          silencedBy: [],
          state: "active",
        },
      }),
    ).toThrow();
    expect(() => normalizeGeneratorUrl("not a URL")).toThrow();
  });

  test("derives last-seen from the latest snapshot only for present open alerts", () => {
    expect(observedLastSeenAtNs(occurrence({ lastSeenAtNs: 10n }), 30n)).toBe(
      30n,
    );
    // A webhook observation newer than the snapshot wins.
    expect(observedLastSeenAtNs(occurrence({ lastSeenAtNs: 40n }), 30n)).toBe(
      40n,
    );
    expect(observedLastSeenAtNs(occurrence({ lastSeenAtNs: 10n }), null)).toBe(
      10n,
    );
    expect(
      observedLastSeenAtNs(
        occurrence({ lastSeenAtNs: 10n, missingSinceNs: 20n }),
        30n,
      ),
    ).toBe(10n);
    expect(
      observedLastSeenAtNs(
        occurrence({
          lastSeenAtNs: 10n,
          lifecycleState: "resolved",
          resolvedAtNs: 20n,
          resolutionSource: "webhook",
        }),
        30n,
      ),
    ).toBe(10n);
  });

  test("diffs label sets into minimal row changes", () => {
    expect(
      labelChanges(
        { alertname: "DiskFull", pod: "old", severity: "warning" },
        { alertname: "DiskFull", pod: "new", node: "torvalds" },
      ),
    ).toEqual({
      removed: ["severity"],
      upserted: [
        ["pod", "new"],
        ["node", "torvalds"],
      ],
    });
    expect(labelChanges({ a: "1" }, { a: "1" })).toEqual({
      removed: [],
      upserted: [],
    });
    expect(sameStringMap({ a: "1", b: "2" }, { b: "2", a: "1" })).toBe(true);
    expect(sameStringMap({ a: "1" }, { a: "1", b: "2" })).toBe(false);
    expect(sameStringMap({ a: "1", c: "2" }, { a: "1", b: "2" })).toBe(false);
  });
});
