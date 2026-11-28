import { readFileSync } from "node:fs";
import { App, Chart } from "cdk8s";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { exportBuildkitdDashboardJson } from "@shepherdjerred/homelab/cdk8s/grafana/buildkitd-dashboard.ts";
import { NVME_STORAGE_CLASS_LZ4 } from "@shepherdjerred/homelab/cdk8s/src/misc/storage/storage-classes.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { createBuildkitdDeployment } from "./buildkitd.ts";

const ConfigMapSchema = z.object({
  kind: z.literal("ConfigMap"),
  data: z.object({ "buildkitd.toml": z.string() }),
});

const PvcSchema = z.object({
  kind: z.literal("PersistentVolumeClaim"),
  metadata: z.object({ name: z.string() }),
  spec: z.object({
    storageClassName: z.string(),
    resources: z.object({ requests: z.object({ storage: z.string() }) }),
  }),
});

describe("buildkitd cache sizing and two-tier GC policy", () => {
  it("provisions a 600Gi zfs-ssd-lz4 PVC and sweeps ephemeral inputs before base layers", () => {
    const chart = new Chart(new App(), "buildkitd", {
      namespace: "buildkitd",
      disableResourceNameHashes: true,
    });
    createBuildkitdDeployment(chart);
    const manifests = chart.toJson();

    const pvc = PvcSchema.parse(
      manifests.find((item) => item.kind === "PersistentVolumeClaim"),
    );
    expect(pvc.metadata.name).toBe("buildkitd-cache-liskov");
    expect(pvc.spec.storageClassName).toBe(NVME_STORAGE_CLASS_LZ4);
    expect(pvc.spec.resources.requests.storage).toBe("600Gi");

    const configMap = ConfigMapSchema.parse(
      manifests.find((item) => item.kind === "ConfigMap"),
    );
    const toml = configMap.data["buildkitd.toml"];

    const ephemeralRule = [
      "[[worker.oci.gcpolicy]]",
      '    keepDuration = "48h"',
      `    maxUsedSpace = ${String(48 * 1024 * 1024 * 1024)}`,
      '    filters = ["type==source.local", "type==source.git.checkout"]',
    ].join("\n");
    const cacheMountRule = [
      "[[worker.oci.gcpolicy]]",
      '    keepDuration = "336h"',
      `    maxUsedSpace = ${String(48 * 1024 * 1024 * 1024)}`,
      '    filters = ["type==exec.cachemount"]',
    ].join("\n");
    const catchAllRule = [
      "[[worker.oci.gcpolicy]]",
      `    maxUsedSpace = ${String(480 * 1024 * 1024 * 1024)}`,
      `    minFreeSpace = ${String(120 * 1024 * 1024 * 1024)}`,
      "    keepDuration = 0",
      "    all = true",
    ].join("\n");

    expect(toml).toContain(ephemeralRule);
    expect(toml).toContain(cacheMountRule);
    expect(toml).toContain(catchAllRule);
    expect(toml.indexOf(ephemeralRule)).toBeLessThan(
      toml.indexOf(cacheMountRule),
    );
    expect(toml.indexOf(cacheMountRule)).toBeLessThan(
      toml.indexOf(catchAllRule),
    );
  });

  it("keeps the buildkitd dashboard GC floor synced at 480Gi", () => {
    const dashboardJson = exportBuildkitdDashboardJson();
    expect(dashboardJson).toContain("vector(480 * 1024 * 1024 * 1024)");
    expect(dashboardJson).toContain("GC floor (480Gi)");
    expect(dashboardJson).not.toContain("240Gi");
  });
});

const DeploymentSchema = z.object({
  kind: z.literal("Deployment"),
  spec: z.object({
    template: z.object({
      spec: z.object({
        containers: z.array(z.object({ name: z.string(), image: z.string() })),
      }),
    }),
  }),
});

function daemonImage(chart: Chart): string | undefined {
  const deployment = DeploymentSchema.parse(
    chart.toJson().find((item) => item.kind === "Deployment"),
  );
  return deployment.spec.template.spec.containers.find(
    (container) => container.name === "buildkitd",
  )?.image;
}

describe("buildkitd daemon image", () => {
  it("runs the upstream catalog release unless the patched image is chosen", () => {
    const chart = new Chart(new App(), "buildkitd", {
      namespace: "buildkitd",
      disableResourceNameHashes: true,
    });
    createBuildkitdDeployment(chart);
    expect(daemonImage(chart)).toMatch(/^moby\/buildkit:v0\.35\.1@sha256:/u);
  });

  it("binds the rewrite-reuse image only through a registered Delivery recipe", () => {
    const chart = new Chart(new App(), "buildkitd", {
      namespace: "buildkitd",
      disableResourceNameHashes: true,
    });
    // The patched image is not registered or published yet, so choosing it
    // fails synthesis instead of rendering an unpinned reference.
    expect(() => {
      createBuildkitdDeployment(chart, { image: "rewrite-reuse" });
    }).toThrow("Unregistered first-party image: buildkitd");
  });
});

describe("patched buildkitd image pins", () => {
  // The patched daemon rebuilds the catalog's moby/buildkit release at the
  // release's commit and overlays it on that release's image. All four must
  // name the same release, so a catalog bump fails here until the patch image
  // is upgraded with it.
  const dockerfile = readFileSync(
    new URL("../../../../images/buildkitd/Dockerfile", import.meta.url),
    "utf8",
  );
  const pin = z
    .object({ tag: z.string(), digest: z.string() })
    .parse(
      /^(?<tag>v[^@]+)@(?<digest>sha256:[a-f0-9]{64})$/u.exec(
        versions["moby/buildkit"],
      )?.groups,
    );
  const header = z
    .object({ tag: z.string(), commit: z.string() })
    .parse(
      /# moby\/buildkit (?<tag>\S+) is commit (?<commit>[0-9a-f]{40})\./u.exec(
        dockerfile,
      )?.groups,
    );

  it("overlays the version catalog's moby/buildkit release", () => {
    expect(dockerfile).toContain(
      `FROM moby/buildkit:${pin.tag}@${pin.digest} AS image`,
    );
  });

  it("builds the commit its header names for that release, under that version", () => {
    expect(header.tag).toBe(pin.tag);
    expect(dockerfile).toContain(`git fetch --depth 1 origin ${header.commit}`);
    expect(dockerfile).toContain(
      `-X github.com/moby/buildkit/version.Revision=${header.commit}`,
    );
    expect(dockerfile).toContain(
      `-X github.com/moby/buildkit/version.Version=${pin.tag}+rewrite-reuse.`,
    );
  });
});
