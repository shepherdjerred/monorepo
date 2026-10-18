import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { deliveryVerdict } from "#lib/deployed/delivery.ts";
import type { DeliveryEvidence, RunningPod } from "#lib/deployed/types.ts";
import { deployedCommand } from "#commands/deployed/deployed.ts";

const boundary = vi.hoisted(() => ({
  overview: vi.fn(),
  argo: vi.fn(),
  pods: vi.fn(),
}));
vi.mock("#lib/deployed/git.ts", () => ({
  repoRoot: () => Promise.resolve("/fixture"),
  fetchMain: () => Promise.resolve(),
  resolveCommit: () =>
    Promise.resolve({
      sha: "a".repeat(40),
      shortSha: "aaaaaaa",
      subject: "change",
    }),
  isAncestor: () => Promise.resolve(true),
  showCatalogAt: () =>
    Bun.file(
      new URL("../../../version-catalog/src/catalog.json", import.meta.url),
    ).text(),
  commitThatWroteDigest: vi.fn(),
  isBumpSubject: vi.fn(),
  latestCommitForPackage: vi.fn(),
  changedPackages: vi.fn(),
}));
vi.mock("#lib/deployed/argocd.ts", () => ({ getArgoApp: boundary.argo }));
vi.mock("#lib/deployed/kubectl.ts", () => ({
  scanPods: boundary.pods,
  podsForVersionKey: () => [],
}));
vi.mock("#lib/deployed/github.ts", () => ({
  openBumpPrs: vi.fn(),
  prForCommit: vi.fn(),
}));
vi.mock("#lib/toolkit-config.ts", () => ({
  loadToolkitConfig: () =>
    Promise.resolve({ value: () => Promise.resolve("configured-delivery") }),
}));
vi.mock("#lib/delivery/client.ts", () => ({
  deliveryClient: () => ({ overview: boundary.overview }),
}));

const evidence: DeliveryEvidence = {
  environmentId: "arcade/prod",
  desired: "version:2",
  observed: "version:1",
  accepted: "version:1",
  observedAt: "2026-10-16T00:00:00.000Z",
  activeDeploymentId: "deployment:2",
  artifacts: [
    {
      component: "server",
      digest: "sha256:expected",
      runtimeDigests: [],
      sourceRevision: "a".repeat(40),
      containsCommit: true,
    },
  ],
};
const pod: RunningPod = {
  namespace: "arcade",
  pod: "server",
  container: "server",
  image: "repo@sha256:expected",
  imageID: "repo@sha256:expected",
  digest: "sha256:expected",
};

describe("PostgreSQL release evidence", () => {
  test("selected revision alone does not prove running state", () => {
    expect(deliveryVerdict(evidence, true, [])).toBe("SELECTED");
    expect(
      deliveryVerdict(evidence, true, [{ ...pod, digest: "sha256:other" }]),
    ).toBe("SELECTED");
  });
  test("runtime match does not mutate or infer acceptance", () => {
    expect(deliveryVerdict(evidence, true, [pod])).toBe("RUNNING");
    expect(evidence.accepted).toBe("version:1");
  });
  test("requires provenance containing the target commit and all image digests", () => {
    expect(
      deliveryVerdict(
        {
          ...evidence,
          artifacts: [
            {
              ...evidence.artifacts[0],
              component: "server",
              digest: "sha256:expected",
              runtimeDigests: [],
              sourceRevision: "a".repeat(40),
              containsCommit: false,
            },
          ],
        },
        true,
        [pod],
      ),
    ).toBe("PENDING");
    expect(
      deliveryVerdict(
        {
          ...evidence,
          artifacts: [
            ...evidence.artifacts,
            {
              component: "worker",
              digest: "sha256:worker",
              runtimeDigests: [],
              sourceRevision: "a".repeat(40),
              containsCommit: true,
            },
          ],
        },
        true,
        [pod],
      ),
    ).toBe("SELECTED");
    expect(deliveryVerdict(evidence, false, [pod])).toBe("NOT_MERGED");
  });
  test("missing selected artifact metadata is unknown", () => {
    expect(deliveryVerdict({ ...evidence, artifacts: [] }, true, [pod])).toBe(
      "UNKNOWN",
    );
  });
  test("accepts an attested platform digest for a multiarchitecture image", () => {
    const selected = {
      ...evidence,
      artifacts: evidence.artifacts.map((artifact) => ({
        ...artifact,
        runtimeDigests: ["sha256:platform"],
      })),
    };
    expect(
      deliveryVerdict(selected, true, [{ ...pod, digest: "sha256:platform" }]),
    ).toBe("RUNNING");
  });
});

describe("deployed command without cluster evidence", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {
      /* Assert the structured command output below. */
    });
    vi.spyOn(process, "exit").mockImplementation((status) => {
      throw new Error(`exit:${String(status)}`);
    });
    boundary.argo.mockResolvedValue({ ok: false, reason: "unavailable" });
    boundary.pods.mockResolvedValue({ ok: false, reason: "unavailable" });
  });
  afterEach(() => vi.restoreAllMocks());

  test.each([
    { name: "no-cluster", noCluster: true, state: "selected" },
    { name: "Argo unavailable", noCluster: false, state: "selected" },
    { name: "Delivery unavailable", noCluster: true, state: "unavailable" },
    { name: "environment missing", noCluster: true, state: "missing" },
    { name: "environment mismatched", noCluster: true, state: "mismatched" },
    { name: "Argo ownership conflicts", noCluster: false, state: "annotation" },
  ])("uses exact managed evidence when $name", async ({ noCluster, state }) => {
    if (state === "annotation") {
      boundary.argo.mockResolvedValue({
        ok: true,
        status: { deliveryEnvironmentId: "other/prod" },
      });
    }
    if (state === "unavailable") {
      boundary.overview.mockRejectedValue(new Error("Delivery unavailable"));
    } else {
      boundary.overview.mockResolvedValue({
        environments:
          state === "missing"
            ? []
            : [
                {
                  id: state === "mismatched" ? "other/prod" : "arcade/prod",
                  application: "arcade",
                  desiredVersionSetRevisionId: "version:2",
                  observedVersionSetRevisionId: "version:1",
                  acceptedVersionSetRevisionId: "version:0",
                  observedAt: null,
                  activeDeploymentId: null,
                },
              ],
        versionSets: [
          {
            id: "version:2",
            components: {
              "image:arcade": {
                kind: "image",
                digest: "sha256:expected",
                runtimeDigests: [],
                sourceRevision: "a".repeat(40),
              },
            },
          },
        ],
      });
    }
    await expect(
      deployedCommand({
        selector: "arcade",
        commit: "HEAD",
        noGithub: true,
        json: true,
        noCluster,
      }),
    ).rejects.toThrow("exit:1");
    expect(boundary.overview).toHaveBeenCalledExactlyOnceWith();
    const output = String(vi.mocked(console.log).mock.calls[0]?.[0]);
    expect(output).toContain(
      `"verdict": "${state === "selected" ? "SELECTED" : "UNKNOWN"}"`,
    );
    expect(output).toContain('"pin": null');
    expect(output).toContain('"pods": []');
    if (state === "selected") {
      expect(output).toContain('"desired": "version:2"');
      expect(output).toContain('"observed": "version:1"');
      expect(output).toContain('"accepted": "version:0"');
    }
    if (noCluster) {
      expect(boundary.argo).not.toHaveBeenCalled();
      expect(boundary.pods).not.toHaveBeenCalled();
    } else {
      expect(boundary.argo).toHaveBeenCalledExactlyOnceWith("arcade");
    }
  });
});
