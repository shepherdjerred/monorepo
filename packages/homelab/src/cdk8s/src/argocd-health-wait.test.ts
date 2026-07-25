import { describe, expect, test } from "bun:test";
import { Testing } from "cdk8s";
import { z } from "zod";
import { applicationReadiness } from "./argocd-application-readiness.ts";
import { createAppsApp } from "./resources/argo-applications/apps.ts";

const AppsManifestSchema = z.tuple([
  z.object({
    metadata: z.object({
      name: z.string(),
      annotations: z.record(z.string(), z.string()),
    }),
  }),
]);

function application(sync?: string, health?: string): Record<string, unknown> {
  const status: Record<string, unknown> = {};
  if (sync !== undefined) {
    status["sync"] = { status: sync };
  }
  if (health !== undefined) {
    status["health"] = { status: health };
  }
  return { status };
}

describe("applicationReadiness", () => {
  test("health-only waits accept an out-of-sync healthy application", () => {
    expect(
      applicationReadiness(application("OutOfSync", "Healthy"), false),
    ).toEqual({ sync: "OutOfSync", health: "Healthy", ready: true });
  });

  test("tree waits require the root application to be synced and healthy", () => {
    expect(
      applicationReadiness(application("OutOfSync", "Healthy"), true),
    ).toEqual({ sync: "OutOfSync", health: "Healthy", ready: false });
    expect(
      applicationReadiness(application("Synced", "Healthy"), true),
    ).toEqual({ sync: "Synced", health: "Healthy", ready: true });
  });

  test("rejects degraded and missing health states", () => {
    expect(
      applicationReadiness(application("Synced", "Degraded"), true),
    ).toEqual({ sync: "Synced", health: "Degraded", ready: false });
    expect(applicationReadiness(application(), true)).toEqual({
      sync: "",
      health: "",
      ready: false,
    });
  });

  test("rejects malformed ArgoCD status values", () => {
    expect(() =>
      applicationReadiness({ status: { health: { status: 42 } } }, true),
    ).toThrow();
  });
});

test("the self-managed root Application is excluded from health aggregation", () => {
  const chart = Testing.chart();
  createAppsApp(chart);
  const [manifest] = AppsManifestSchema.parse(Testing.synth(chart));

  expect(manifest.metadata).toEqual({
    name: "apps",
    annotations: { "argocd.argoproj.io/ignore-healthcheck": "true" },
  });
});
