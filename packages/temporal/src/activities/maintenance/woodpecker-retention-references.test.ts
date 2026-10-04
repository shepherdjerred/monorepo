import { describe, expect, test } from "vitest";
import {
  artifactPipelineNumber,
  deployedArtifactReferences,
} from "./woodpecker-retention-references.ts";

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

describe("Woodpecker deployed artifact references", () => {
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
