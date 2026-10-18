import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { App, Testing } from "cdk8s";
import { describe, expect, it } from "vitest";
import { parseAllDocuments, stringify } from "yaml";
import { createStormForumChart } from "./index.ts";
import { resetProbeRegistry } from "@shepherdjerred/homelab/cdk8s/src/misc/probes/probe-registry.ts";

const release = {
  stage: "prod" as const,
  image: `docker.io/shepherdjerred/storm-forum@sha256:${"a".repeat(64)}`,
  secretItemId: "a".repeat(26),
  bundleSha256: "b".repeat(64),
  bundleKey: "releases/legacy.zip",
  releaseId: "c".repeat(12),
  trustedConnectorCidr: "10.244.0.0/24",
  preUpgradeBackup: {
    bundleSha256: "d".repeat(64),
    xenforoVersion: "2.3.13",
    runtimeImage: `docker.io/shepherdjerred/storm-forum@sha256:${"e".repeat(64)}`,
  },
};

async function render(values: Record<string, unknown>) {
  const directory = await mkdtemp(path.join(tmpdir(), "forum-delivery-helm-"));
  try {
    resetProbeRegistry();
    const chart = createStormForumChart(new App(), {
      stage: release.stage,
      secretItemId: release.secretItemId,
      trustedConnectorCidr: release.trustedConnectorCidr,
    });
    await mkdir(path.join(directory, "templates"));
    await writeFile(
      path.join(directory, "Chart.yaml"),
      "apiVersion: v2\nname: forum-delivery-test\nversion: 1.0.0\n",
    );
    await writeFile(
      path.join(directory, "values.yaml"),
      stringify({ delivery: values }),
    );
    await writeFile(
      path.join(directory, "templates/forum.yaml"),
      Testing.synth(chart)
        .map((resource) => stringify(resource))
        .join("---\n"),
    );
    const child = Bun.spawn(["helm", "template", "test", directory], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    const json =
      exitCode === 0
        ? JSON.stringify(
            parseAllDocuments(stdout).map(
              (document) => document.toJSON() as unknown,
            ),
          )
        : "";
    return { exitCode, stdout, stderr, json };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe("forum selected release rendering", () => {
  it("has no legacy selected-release fallback in a production chart", async () => {
    const result = await render({});
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Delivery requires");
  });
  it("renders exact selected artifacts and the previous accepted backup source while retaining safety gates", async () => {
    const result = await render({
      image: `docker.io/shepherdjerred/storm-forum@sha256:${"f".repeat(64)}`,
      releaseId: "0123456789abcdef",
      bundleKey: "releases/selected.zip",
      bundleSha256: "1".repeat(64),
      previousBundleSha256: "2".repeat(64),
      previousXenforoVersion: "2.3.12",
      previousRuntimeImage: release.image,
    });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toContain("storm-forum-release-0123456789abcdef");
    expect(result.stdout).toContain("releases/selected.zip");
    expect(result.json).toContain(
      `docker.io/shepherdjerred/storm-forum@sha256:${"f".repeat(64)}`,
    );
    expect(result.stdout).not.toContain("releases/legacy.zip");
    expect(result.stdout).toContain("BACKUP_SOURCE_XENFORO_VERSION");
    expect(result.stdout).toContain("2.3.12");
    expect(result.stdout).toContain("backoffLimit: 0");
    expect(result.stdout).toContain("activeDeadlineSeconds: 3600");
    expect(result.stdout).toContain("ADMIN_PASSWORD");
  });
  it("refuses partial input even when a valid image is selected", async () => {
    const result = await render({ image: release.image });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Delivery requires");
  });
});
