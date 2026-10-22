import { describe, expect, test } from "vitest";
import { alarmQuery, monitorWindow, selfHealDrift } from "./monitor.ts";

describe("monitor observation (W4, W5)", () => {
  test("the window covers the time since acceptance and never less than two minutes", () => {
    const now = new Date("2026-10-21T01:00:00.000Z");
    expect(monitorWindow("2026-10-21T00:59:30.000Z", now)).toBe("120s");
    expect(monitorWindow("2026-10-21T00:00:00.000Z", now)).toBe("3600s");
  });

  test("alarms are firing ALERTS scoped by the monitor's matchers and severities", () => {
    expect(
      alarmQuery({
        component: "image:arcade",
        alarms: {
          matchers: { namespace: "arcade", environment: "arcade/prod" },
          severities: ["warning", "critical"],
        },
        evidence: [{ key: "requests", query: "up", threshold: 1 }],
        policy: "automatic",
      }),
    ).toBe(
      'ALERTS{environment="arcade/prod",namespace="arcade",alertstate="firing",severity=~"warning|critical"}',
    );
  });
});

function application(automated: boolean, startedAt: string) {
  return {
    status: {
      operationState: {
        phase: "Succeeded",
        startedAt,
        operation: { initiatedBy: { automated } },
        syncResult: {
          revision: "1.0.0",
          resources: [
            {
              group: "apps",
              kind: "Deployment",
              namespace: "arcade",
              name: "arcade",
            },
          ],
        },
      },
    },
  };
}

describe("self-heal drift (T4)", () => {
  const input = {
    application: "arcade",
    acceptedAt: "2026-10-21T00:00:00.000Z",
    observedAt: new Date("2026-10-21T02:00:00.000Z"),
  };

  test("an automated sync after acceptance is drift with the resources it reverted", () => {
    expect(
      selfHealDrift(application(true, "2026-10-21T01:00:00Z"), input),
    ).toEqual({
      observedAt: "2026-10-21T02:00:00.000Z",
      application: "arcade",
      startedAt: "2026-10-21T01:00:00Z",
      phase: "Succeeded",
      revision: "1.0.0",
      resources: ["apps/Deployment/arcade/arcade"],
    });
  });

  test("Delivery's own sync and syncs before acceptance are not drift", () => {
    expect(
      selfHealDrift(application(false, "2026-10-21T01:00:00Z"), input),
    ).toBeNull();
    expect(
      selfHealDrift(application(true, "2026-10-20T23:00:00Z"), input),
    ).toBeNull();
    expect(selfHealDrift({}, input)).toBeNull();
  });
});
