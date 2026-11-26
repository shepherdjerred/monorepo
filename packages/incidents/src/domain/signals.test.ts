import { describe, expect, it } from "vitest";
import {
  INCIDENT_ALERTNAMES,
  INCIDENT_ALERT_RULES,
} from "#shared/alert-rules.ts";
import { AlertmanagerWebhookSchema } from "#shared/alertmanager.ts";
import { alertmanagerSignals } from "#domain/alertmanager.ts";
import { take } from "#domain/command.ts";
import type { IncidentRecord } from "#domain/model.ts";
import {
  applySignal,
  AUTO_RESOLVE_NOTE,
  type SignalDecision,
} from "#domain/signals.ts";
import {
  actor,
  contextAt,
  minutes,
  record,
  SETTINGS,
  signal,
  T0,
} from "#testing/records.ts";

const system = actor("system:main-ci");

function committed(decision: SignalDecision, number = 1): IncidentRecord {
  if (decision.kind === "ignore")
    throw new Error(`ignored: ${decision.reason}`);
  return { ...decision.transition.next, number };
}

describe("applySignal", () => {
  it("auto-opens an unowned incident for a firing signal with its suspect", () => {
    const decision = applySignal(
      signal({
        suspect: { prNumber: 5142, sessionId: "session_01X" },
        links: [{ kind: "pipeline", ref: "19256" }],
      }),
      contextAt(T0, system),
      [],
      SETTINGS,
    );
    expect(decision.outcome).toBe("opened");
    const opened = committed(decision);
    expect(opened).toMatchObject({
      source: "main-ci",
      systems: ["main-ci"],
      commandState: "none",
      creatorId: "system:main-ci",
      suspect: { prNumber: 5142, sessionId: "session_01X" },
    });
    expect(opened.signals).toEqual([
      {
        key: "main-ci:main",
        source: "main-ci",
        title: "main is red",
        firing: true,
        firstFiredAt: T0,
        lastChangedAt: T0,
      },
    ]);
    if (decision.kind !== "create") throw new Error("expected create");
    expect(decision.transition.events.map((event) => event.type)).toEqual([
      "declared",
      "signal-firing",
    ]);
  });

  it("ignores repeats, stale reports, and clears with nothing attached", () => {
    const opened = committed(
      applySignal(signal(), contextAt(T0, system), [], SETTINGS),
    );
    expect(
      applySignal(
        signal({ observedAt: minutes(5).toISOString() }),
        contextAt(minutes(5), system),
        [opened],
        SETTINGS,
      ),
    ).toMatchObject({
      kind: "ignore",
      reason: "already firing",
    });
    expect(
      applySignal(
        signal({ firing: false, observedAt: minutes(-1).toISOString() }),
        contextAt(T0, system),
        [opened],
        SETTINGS,
      ),
    ).toMatchObject({
      kind: "ignore",
      reason: "out of order",
    });
    expect(
      applySignal(
        signal({ firing: false }),
        contextAt(T0, system),
        [],
        SETTINGS,
      ),
    ).toMatchObject({
      kind: "ignore",
      reason: "nothing attached",
    });
  });

  it("respects the per-producer auto-open flags but still attaches", () => {
    const off = { ...SETTINGS, autoOpenMainCi: false };
    expect(applySignal(signal(), contextAt(T0, system), [], off)).toMatchObject(
      { kind: "ignore", reason: "auto-open disabled" },
    );
    const manual = record({ systems: ["main-ci"] });
    expect(
      applySignal(signal(), contextAt(T0, system), [manual], off).outcome,
    ).toBe("attached");
  });

  it("attaches to the open incident for the system and escalates severity", () => {
    const manual = record({ systems: ["delivery"], severity: "sev3" });
    const decision = applySignal(
      signal({
        source: "alertmanager",
        key: "fp1",
        system: "delivery",
        severity: "sev1",
      }),
      contextAt(T0, system),
      [manual],
      SETTINGS,
    );
    expect(decision.outcome).toBe("attached");
    const next = committed(decision);
    expect(next.severity).toBe("sev1");
    if (decision.kind !== "update") throw new Error("expected update");
    expect(decision.previous).toBe(manual);
    expect(decision.transition.events.map((event) => event.type)).toEqual([
      "signal-firing",
      "severity-changed",
    ]);
  });

  it("routes alerts during active maintenance to the maintenance window", () => {
    const window = {
      ...record({ kind: "maintenance", systems: ["delivery"] }),
      status: "in_progress" as const,
    };
    const decision = applySignal(
      signal({ key: "fp1", system: "delivery", source: "alertmanager" }),
      contextAt(T0, system),
      [window],
      SETTINGS,
    );
    expect(decision.outcome).toBe("attached");
    expect(committed(decision).id).toBe(window.id);
  });
});

describe("applySignal clearing", () => {
  it("auto-resolves when every signal clears and nobody ever claimed it", () => {
    const opened = committed(
      applySignal(signal(), contextAt(T0, system), [], SETTINGS),
    );
    const decision = applySignal(
      signal({ firing: false, observedAt: minutes(5).toISOString() }),
      contextAt(minutes(5), system),
      [opened],
      SETTINGS,
    );
    expect(decision.outcome).toBe("auto-resolved");
    expect(committed(decision)).toMatchObject({
      status: "resolved",
      resolutionNote: AUTO_RESOLVE_NOTE,
    });
    if (decision.kind !== "update") throw new Error("expected update");
    expect(decision.transition.events.map((event) => event.type)).toEqual([
      "signal-cleared",
      "resolved",
    ]);
  });

  it("only reports the clear once someone has claimed command", () => {
    const opened = committed(
      applySignal(signal(), contextAt(T0, system), [], SETTINGS),
    );
    const claimed = take(
      opened,
      contextAt(minutes(11), actor("fixer")),
      {
        dispatch: false,
        force: false,
        note: null,
        dispatchToken: "t".repeat(16),
      },
      SETTINGS,
    ).transition.next;
    const decision = applySignal(
      signal({ firing: false, observedAt: minutes(12).toISOString() }),
      contextAt(minutes(12), system),
      [claimed],
      SETTINGS,
    );
    expect(decision.outcome).toBe("cleared");
    expect(committed(decision).status).toBe("investigating");
  });

  it("waits for every attached signal before auto-resolving", () => {
    const opened = committed(
      applySignal(
        signal({ source: "alertmanager", key: "a", system: "delivery" }),
        contextAt(T0, system),
        [],
        SETTINGS,
      ),
    );
    const both = committed(
      applySignal(
        signal({ source: "alertmanager", key: "b", system: "delivery" }),
        contextAt(T0, system),
        [opened],
        SETTINGS,
      ),
    );
    const one = applySignal(
      signal({
        source: "alertmanager",
        key: "a",
        system: "delivery",
        firing: false,
      }),
      contextAt(T0, system),
      [both],
      SETTINGS,
    );
    expect(one.outcome).toBe("cleared");
  });

  it("never auto-resolves a manually declared incident", () => {
    const manual = record({ systems: ["main-ci"] });
    const attached = committed(
      applySignal(signal(), contextAt(T0, system), [manual], SETTINGS),
    );
    expect(
      applySignal(
        signal({ firing: false }),
        contextAt(T0, system),
        [attached],
        SETTINGS,
      ).outcome,
    ).toBe("cleared");
  });
});

const webhook = (alerts: unknown[]) =>
  AlertmanagerWebhookSchema.parse({
    version: "4",
    groupKey: '{}:{alertname="DeliveryRecoveryRequired"}',
    truncatedAlerts: 0,
    status: "firing",
    receiver: "incidents",
    groupLabels: {},
    commonLabels: {},
    commonAnnotations: {},
    externalURL: "http://alertmanager.example:9093",
    alerts,
  });

describe("Alertmanager translation", () => {
  it("maps curated alerts through the rule table and ignores the rest", () => {
    const translation = alertmanagerSignals(
      webhook([
        {
          status: "firing",
          labels: {
            alertname: "DeliveryRecoveryRequired",
            environment: "temporal-workers",
          },
          annotations: {
            summary: "temporal-workers requires recovery",
            message: "It keeps its locks.",
            runbook_url: "https://docs.example/runbook",
          },
          startsAt: "2026-11-25T11:58:01.123456789Z",
          endsAt: "0001-01-01T00:00:00Z",
          generatorURL: "http://prometheus.example/graph?g0.expr=up",
          fingerprint: "fp-delivery",
        },
        {
          status: "resolved",
          labels: { alertname: "SomethingElse" },
          annotations: {},
          startsAt: "2026-11-25T11:00:00Z",
          endsAt: "2026-11-25T11:30:00Z",
          generatorURL: "",
          fingerprint: "fp-other",
        },
      ]),
    );
    expect(translation.ignored).toBe(1);
    expect(translation.signals).toEqual([
      {
        source: "alertmanager",
        key: "fp-delivery",
        firing: true,
        system: "delivery",
        severity: "sev1",
        title: "temporal-workers requires recovery",
        summary: "It keeps its locks.",
        exitCondition:
          INCIDENT_ALERT_RULES.DeliveryRecoveryRequired.exitCondition,
        observedAt: "2026-11-25T11:58:01.123456789Z",
        links: [
          {
            kind: "alert",
            ref: "fp-delivery",
            title: "DeliveryRecoveryRequired",
            url: "http://prometheus.example/graph?g0.expr=up",
          },
          {
            kind: "url",
            ref: "https://docs.example/runbook",
            url: "https://docs.example/runbook",
            title: "Runbook",
          },
        ],
      },
    ]);
  });

  it("uses endsAt for resolved alerts", () => {
    const [cleared] = alertmanagerSignals(
      webhook([
        {
          status: "resolved",
          labels: { alertname: "DeliveryQueueStalled" },
          annotations: {},
          startsAt: "2026-11-25T11:00:00Z",
          endsAt: "2026-11-25T11:30:00Z",
          generatorURL: "/graph",
          fingerprint: "fp-queue",
        },
      ]),
    ).signals;
    expect(cleared).toMatchObject({
      firing: false,
      observedAt: "2026-11-25T11:30:00Z",
      title: "DeliveryQueueStalled",
    });
    expect(cleared?.links).toEqual([
      { kind: "alert", ref: "fp-queue", title: "DeliveryQueueStalled" },
    ]);
  });

  it("curates every Delivery control-plane alert that blocks releases", async () => {
    const monitoring = await Bun.file(
      new URL(
        "../../../homelab/src/cdk8s/src/resources/delivery/monitoring.ts",
        import.meta.url,
      ),
    ).text();
    for (const alertname of INCIDENT_ALERTNAMES)
      expect(monitoring).toContain(`alert: "${alertname}"`);
    expect(Object.keys(INCIDENT_ALERT_RULES).sort()).toEqual(
      [...INCIDENT_ALERTNAMES].sort(),
    );
  });
});
