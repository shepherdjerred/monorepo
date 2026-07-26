import { describe, expect, test } from "bun:test";

import {
  applicationReadiness,
  unreadyApplicationSummaries,
} from "./argocd-application-readiness.ts";

describe("applicationReadiness", () => {
  test("requires Synced only when asked", () => {
    const app = {
      status: { sync: { status: "OutOfSync" }, health: { status: "Healthy" } },
    };
    expect(applicationReadiness(app, true).ready).toBe(false);
    expect(applicationReadiness(app, false).ready).toBe(true);
  });
});

describe("unreadyApplicationSummaries", () => {
  const list = {
    items: [
      {
        metadata: { name: "healthy-app" },
        status: { sync: { status: "Synced" }, health: { status: "Healthy" } },
      },
      {
        // The build 6322 shape: sync succeeded but an orphaned resource keeps
        // the app OutOfSync forever.
        metadata: { name: "turbo-cache" },
        status: {
          sync: { status: "OutOfSync" },
          health: { status: "Healthy" },
          resources: [
            { kind: "Deployment", name: "turbo-cache", status: "Synced" },
            {
              kind: "OnePasswordItem",
              name: "turbo-cache-r2",
              status: "OutOfSync",
            },
          ],
        },
      },
      {
        // The build 6333 shape: Synced but a crash-looping pod keeps the app
        // Progressing past the health-wait deadline.
        metadata: { name: "mario-kart" },
        status: {
          sync: { status: "Synced" },
          health: { status: "Progressing" },
          resources: [
            {
              kind: "Deployment",
              name: "mario-kart",
              status: "Synced",
              health: {
                status: "Progressing",
                message: "waiting for rollout",
              },
            },
          ],
        },
      },
    ],
  };

  test("names each app failing the gate with its offending resources", () => {
    const lines = unreadyApplicationSummaries(list, true);
    expect(lines).toEqual([
      "turbo-cache: Sync=OutOfSync Health=Healthy — OnePasswordItem/turbo-cache-r2",
      "mario-kart: Sync=Synced Health=Progressing — Deployment/mario-kart (waiting for rollout)",
    ]);
  });

  test("ignores sync state when the gate is health-only", () => {
    const lines = unreadyApplicationSummaries(list, false);
    expect(lines).toEqual([
      "mario-kart: Sync=Synced Health=Progressing — Deployment/mario-kart (waiting for rollout)",
    ]);
  });

  test("tolerates an empty or null item list", () => {
    expect(unreadyApplicationSummaries({ items: null }, true)).toEqual([]);
    expect(unreadyApplicationSummaries({}, true)).toEqual([]);
  });
});
