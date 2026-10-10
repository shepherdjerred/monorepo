import { App, Testing } from "cdk8s";
import { describe, expect, it } from "vitest";
import { createGlitterBoysLauncherChart } from "./glitter-boys-launcher.ts";
import { resetProbeRegistry } from "@shepherdjerred/homelab/cdk8s/src/misc/probes/probe-registry.ts";

describe("launcher service release", () => {
  it("prepares without creating a workload or requiring credentials", () => {
    expect(Testing.synth(createGlitterBoysLauncherChart(new App()))).toEqual(
      [],
    );
  });
  it("rejects unpublished and mutable images before activation", () => {
    for (const image of ["latest", `0.1.0@sha256:${"0".repeat(64)}`]) {
      expect(() =>
        createGlitterBoysLauncherChart(
          new App(),
          { schemaVersion: 1, stage: "active" },
          image,
        ),
      ).toThrow();
    }
  });
  it("keeps metrics private and deploys reporting with monitoring", () => {
    resetProbeRegistry();
    const resources = Testing.synth(
      createGlitterBoysLauncherChart(
        new App(),
        { schemaVersion: 1, stage: "active" },
        `0.1.0@sha256:${"a".repeat(64)}`,
      ),
    );
    const json = JSON.stringify(resources);
    expect(resources.filter((r) => r.kind === "Deployment")).toHaveLength(1);
    expect(resources.filter((r) => r.kind === "ServiceMonitor")).toHaveLength(
      1,
    );
    expect(resources.filter((r) => r.kind === "PrometheusRule")).toHaveLength(
      1,
    );
    expect(json).toContain('"runAsNonRoot":true');
    expect(json).toContain('"readOnlyRootFilesystem":true');
    const tunnels = resources.filter((r) => r.kind === "TunnelBinding");
    expect(tunnels).toHaveLength(1);
    const publicService = resources.find(
      (r) =>
        r.kind === "Service" &&
        r.metadata?.name === "glitter-boys-launcher-http",
    );
    expect(JSON.stringify(publicService)).toContain("8080");
    expect(JSON.stringify(publicService)).not.toContain("9091");
    expect(JSON.stringify(tunnels)).not.toContain("9091");
    expect(json).toContain('"SENTRY_DSN"');
    expect(json).toContain('"homelab_grafana_dashboard":"1"');
  });
});
