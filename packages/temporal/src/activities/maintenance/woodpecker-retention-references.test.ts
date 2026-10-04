import { describe, expect, test } from "vitest";
import { ApplicationFailure } from "@temporalio/common";
import {
  artifactPipelineNumber,
  deployedArtifactReferences,
  retentionReferences,
} from "./woodpecker-retention-references.ts";
import { retentionTestRepo } from "./woodpecker-retention-test-fixtures.ts";

const digest = `@sha256:${"a".repeat(64)}`;
const read =
  (images: string[], apps: unknown[] = []) =>
  (path: string) =>
    Promise.resolve({
      metadata: {},
      items: path.includes("argoproj")
        ? apps
        : path.includes("deployments")
          ? []
          : images.map((image) => ({ spec: { containers: [{ image }] } })),
    });

const chartApplication = (repoURL: string, revision = "2.0.0-1004300") => ({
  metadata: { name: "chart" },
  spec: { source: { repoURL, targetRevision: revision } },
  status: { sync: { revision } },
});

function laterReads(): never {
  throw new Error("Authorization rejection must stop later API reads");
}

describe("Woodpecker deployed artifact references", () => {
  test.each([403, 404])(
    "GitHub HTTP %s authorization rejection stops reference discovery",
    async (status) => {
      const error = ApplicationFailure.nonRetryable(
        `Retention API rejected GET /repos/shepherdjerred/monorepo/pulls (HTTP ${String(status)})`,
        "RetentionAuthorizationOrContractError",
      );
      await expect(
        retentionReferences(
          retentionTestRepo,
          laterReads,
          () => Promise.reject(error),
          laterReads,
        ),
      ).rejects.toBe(error);
      expect(error.nonRetryable).toBe(true);
    },
  );
  test("the deployed Kueue scheme-less OCI source is external, without throwing", async () => {
    const result = await deployedArtifactReferences(
      read(
        ["ghcr.io/shepherdjerred/worker:2.0.0-1004207"],
        [chartApplication("registry.k8s.io/kueue/charts", "0.19.0")],
      ),
    );
    expect(result.complete).toBe(true);
    expect([...result.numbers]).toEqual([4207]);
  });
  test.each([
    "https://chartmuseum.tailnet-1a49.ts.net",
    "chartmuseum.tailnet-1a49.ts.net/charts",
    "oci://chartmuseum.tailnet-1a49.ts.net/charts",
  ])(
    "first-party repository %s retains exact chart provenance",
    async (identifier) => {
      const result = await deployedArtifactReferences(
        read([], [chartApplication(identifier)]),
      );
      expect(result.complete).toBe(true);
      expect([...result.numbers]).toEqual([4300]);
    },
  );
  test("host lookalikes are external and cannot prove a first-party pipeline", async () => {
    const result = await deployedArtifactReferences(
      read(
        ["ghcr.io/shepherdjerred/worker:2.0.0-1004207"],
        [
          chartApplication(
            "chartmuseum.tailnet-1a49.ts.net.example.com/charts",
          ),
        ],
      ),
    );
    expect(result.complete).toBe(true);
    expect([...result.numbers]).toEqual([4207]);
  });
  test.each([
    "https://chartmuseum.tailnet-1a49.ts.net:invalid/charts",
    "https:/chartmuseum.tailnet-1a49.ts.net/charts",
    "chartmuseum.tailnet-1a49.ts.net/bad path",
    "file:///chartmuseum.tailnet-1a49.ts.net/charts",
  ])(
    "invalid repository %s preserves conservative protection with a reason",
    async (identifier) => {
      const result = await deployedArtifactReferences(
        read(
          ["ghcr.io/shepherdjerred/worker:2.0.0-1004207"],
          [chartApplication(identifier)],
        ),
      );
      expect(result.complete).toBe(false);
      expect(result.protectionReasons).toEqual([
        "Application chart has an invalid repository identifier",
      ]);
      expect([...result.numbers]).toEqual([4207]);
    },
  );
  test("inverts the reviewed publisher offset and rejects unrelated versions", () => {
    expect(artifactPipelineNumber(`2.0.0-1004207${digest}`)).toBe(4207);
    expect(artifactPipelineNumber("~2.0.0-0")).toBeUndefined();
    expect(artifactPipelineNumber("2.0.0-17926")).toBeUndefined();
    expect(artifactPipelineNumber("2.0.0-1000000")).toBeUndefined();
  });
  test("mixed known Buildkite/modern images do not invent Woodpecker references", async () => {
    const result = await deployedArtifactReferences(
      read([
        `ghcr.io/shepherdjerred/worker:2.0.0-1004207${digest}`,
        `ghcr.io/shepherdjerred/old:2.0.0-17926${digest}`,
      ]),
    );
    expect(result.complete).toBe(true);
    expect([...result.numbers]).toEqual([4207]);
  });
  test("actual and exact desired chart revisions are both protected; known root aggregator is excluded", async () => {
    const result = await deployedArtifactReferences(
      read(
        [],
        [
          { metadata: { name: "apps" }, spec: {}, status: {} },
          {
            metadata: { name: "temporal" },
            spec: {
              source: {
                repoURL: "https://chartmuseum.tailnet-1a49.ts.net",
                targetRevision: "2.0.0-1004300",
              },
            },
            status: { sync: { revision: "2.0.0-1004207" } },
          },
        ],
      ),
    );
    expect(result.complete).toBe(true);
    expect([...result.numbers]).toEqual([4207, 4300]);
  });
  test("digest-only, ad-hoc and unresolved chart revisions fail closed with visible reasons", async () => {
    const result = await deployedArtifactReferences(
      read(
        [
          "ghcr.io/shepherdjerred/worker:2.0.0-1004207",
          `ghcr.io/shepherdjerred/ci-base${digest}`,
          `ghcr.io/shepherdjerred/the-storm:adhoc-test${digest}`,
        ],
        [
          {
            metadata: { name: "mcp" },
            spec: {
              source: {
                repoURL: "https://chartmuseum.tailnet-1a49.ts.net",
                targetRevision: "~2.0.0-0",
              },
            },
            status: { sync: { revision: "~2.0.0-0" } },
          },
        ],
      ),
    );
    expect(result.complete).toBe(false);
    expect(result.protectionReasons).toHaveLength(3);
    expect(result.protectionReasons.join(" ")).toContain("~2.0.0-0");
  });
  test("an Application missing optional source/status is not misread as a Pod", async () => {
    const result = await deployedArtifactReferences(
      read([], [{ metadata: { name: "unknown" }, spec: {} }]),
    );
    expect(result.complete).toBe(false);
  });
});
