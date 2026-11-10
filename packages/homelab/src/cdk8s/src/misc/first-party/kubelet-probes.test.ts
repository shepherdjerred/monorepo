import { Testing } from "cdk8s";
import { Deployment } from "cdk8s-plus-31";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { httpProbes } from "./kubelet-probes.ts";

const ProbeSpec = z.object({
  httpGet: z.object({ path: z.string(), port: z.number() }),
  periodSeconds: z.number().optional(),
  failureThreshold: z.number(),
});
const Workload = z.object({
  kind: z.literal("Deployment"),
  spec: z.object({
    template: z.object({
      spec: z.object({
        containers: z
          .array(
            z.object({
              startupProbe: ProbeSpec.optional(),
              livenessProbe: ProbeSpec.optional(),
              readinessProbe: ProbeSpec.optional(),
            }),
          )
          .length(1),
      }),
    }),
  }),
});

function render(probes: ReturnType<typeof httpProbes>) {
  const chart = Testing.chart();
  new Deployment(chart, "workload", {
    containers: [{ image: "example", ...probes }],
  });
  const [workload] = Testing.synth(chart).flatMap((document) => {
    const parsed = Workload.safeParse(document);
    return parsed.success ? [parsed.data] : [];
  });
  return workload?.spec.template.spec.containers[0];
}

describe("httpProbes", () => {
  test("liveness polls every 30s and readiness every 10s, each failing after three misses", () => {
    const container = render(
      httpProbes(7351, { live: "/healthz", ready: "/readyz" }),
    );
    expect(container?.livenessProbe).toEqual({
      httpGet: { path: "/healthz", port: 7351 },
      periodSeconds: 30,
      failureThreshold: 3,
    });
    expect(container?.readinessProbe).toEqual({
      httpGet: { path: "/readyz", port: 7351 },
      periodSeconds: 10,
      failureThreshold: 3,
    });
  });

  test("no startup probe is rendered unless one is asked for", () => {
    const container = render(
      httpProbes(3000, { live: "/livez", ready: "/healthz" }),
    );
    expect(container?.startupProbe).toBeUndefined();
  });

  test("the startup probe defaults to the liveness path every 5s", () => {
    const container = render(
      httpProbes(8080, {
        live: "/live",
        ready: "/ready",
        startup: { failureThreshold: 24 },
      }),
    );
    expect(container?.startupProbe).toEqual({
      httpGet: { path: "/live", port: 8080 },
      periodSeconds: 5,
      failureThreshold: 24,
    });
  });

  test("the startup probe's path and period can be set for a slow or separate endpoint", () => {
    const container = render(
      httpProbes(8080, {
        live: "/livez",
        ready: "/healthz",
        startup: { failureThreshold: 30, periodSeconds: 10, path: "/ping" },
      }),
    );
    expect(container?.startupProbe).toEqual({
      httpGet: { path: "/ping", port: 8080 },
      periodSeconds: 10,
      failureThreshold: 30,
    });
  });
});
