import { App, Testing } from "cdk8s";
import { describe, expect, it } from "vitest";
import { createStormForumChart } from "./index.ts";
import { resetProbeRegistry } from "@shepherdjerred/homelab/cdk8s/src/misc/probes/probe-registry.ts";

const fixture = {
  stage: "beta" as const,
  image: `ghcr.io/shepherdjerred/storm-forum@sha256:${"a".repeat(64)}`,
  secretItemId: "a".repeat(26),
  bundleSha256: "b".repeat(64),
  bundleKey: "releases/test.zip",
  releaseId: "c".repeat(12),
  trustedConnectorCidr: "10.244.0.0/16",
};

describe("forum isolation and release resources", () => {
  it("keeps staging private, password protected, and installs only through an explicit Job", () => {
    resetProbeRegistry();
    const chart = createStormForumChart(new App(), fixture);
    const rendered = Testing.synth(chart);
    const json = JSON.stringify(rendered);
    expect(
      rendered.filter((resource) => resource.kind === "TunnelBinding"),
    ).toHaveLength(0);
    expect(json).toContain(
      "auth_basic_user_file /etc/storm-forum/staging.htpasswd",
    );
    expect(json).toContain('"type":"Recreate"');
    expect(json).toContain('"runAsNonRoot":true');
    expect(json).toContain('"storage":"32Gi"');
    const deployments = rendered.filter(
      (resource) => resource.kind === "Deployment",
    );
    expect(JSON.stringify(deployments)).not.toContain('"release"]');
    expect(rendered.filter((resource) => resource.kind === "Job")).toHaveLength(
      1,
    );
    const database = rendered.find(
      (resource) =>
        resource.kind === "Deployment" &&
        JSON.stringify(resource.metadata).includes("storm-forum-database"),
    );
    const web = rendered.find(
      (resource) =>
        resource.kind === "Deployment" &&
        JSON.stringify(resource.metadata).includes("storm-forum-web"),
    );
    expect(JSON.stringify(database?.metadata)).toContain(
      '"argocd.argoproj.io/sync-wave":"-1"',
    );
    expect(JSON.stringify(web?.metadata)).toContain(
      '"argocd.argoproj.io/sync-wave":"1"',
    );
    expect(
      rendered.filter((resource) => resource.kind === "CronJob"),
    ).toHaveLength(0);
    const role = rendered.find((resource) => resource.kind === "Role");
    expect(role?.rules).toEqual([
      {
        apiGroups: ["apps"],
        resources: ["statefulsets"],
        resourceNames: ["minecraft-tsmc"],
        verbs: ["get"],
      },
    ]);
  });
  it("rejects a mutable image tag before creating infrastructure", () => {
    expect(() =>
      createStormForumChart(new App(), {
        ...fixture,
        image: "ghcr.io/shepherdjerred/storm-forum:latest",
      }),
    ).toThrow();
  });
  it("refuses the catalog's unpublished bootstrap marker for an active release", () => {
    expect(() =>
      createStormForumChart(new App(), {
        ...fixture,
        image: `ghcr.io/shepherdjerred/storm-forum@sha256:${"0".repeat(64)}`,
      }),
    ).toThrow();
  });
});
