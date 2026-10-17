import { describe, expect, test } from "vitest";
import { ArtifactVersionSchema } from "@shepherdjerred/delivery/contract";
import {
  RootReleaseInputSchema,
  rootReleaseCommand,
} from "#scripts/jobs/root-release.ts";
import { tofuApplyCommand } from "#scripts/jobs/tofu-apply.ts";

const artifact = ArtifactVersionSchema.parse({
  id: "apps/1",
  component: "chart:apps",
  kind: "chart",
  uri: "https://chartmuseum.tailnet-1a49.ts.net/charts/apps-2.0.0-123.tgz",
  version: "2.0.0-123",
  digest: `sha256:${"a".repeat(64)}`,
  serviceId: "ci",
  buildId: "build/123",
  sourceRevision: "a".repeat(40),
  createdAt: "2026-10-16T00:00:00.000Z",
});
const input = {
  requestId: "f8d36d3a-e74e-4b28-a661-b03ed85c7e55",
  charts: [{ name: "apps", artifact }],
};

describe("reviewed isolated deployment Job recipes", () => {
  test("root recipe invokes the existing request-bound release-root command", () => {
    expect(rootReleaseCommand(input, "/tmp/expected.json")).toEqual([
      "bun",
      "--no-install",
      "packages/homelab/scripts/argocd/argocd.ts",
      "release-root",
      "apps",
      "/tmp/expected.json",
      "--revision",
      "2.0.0-123",
      "--request-id",
      input.requestId,
    ]);
  });
  test("root recipe rejects duplicates, moving revisions, foreign archives, and caller-selected pruning", () => {
    expect(
      RootReleaseInputSchema.safeParse({
        ...input,
        charts: [...input.charts, ...input.charts],
      }).success,
    ).toBe(false);
    expect(
      RootReleaseInputSchema.safeParse({
        ...input,
        charts: [
          { name: "apps", artifact: { ...artifact, version: "latest" } },
        ],
      }).success,
    ).toBe(false);
    expect(
      RootReleaseInputSchema.safeParse({
        ...input,
        charts: [
          {
            name: "apps",
            artifact: { ...artifact, uri: "https://example.com/apps.tgz" },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      RootReleaseInputSchema.safeParse({
        ...input,
        charts: [{ name: "apps", artifact, prune: true }],
      }).success,
    ).toBe(false);
    expect(
      RootReleaseInputSchema.safeParse({
        ...input,
        charts: [
          { name: "apps", artifact: { ...artifact, component: "chart:other" } },
        ],
      }).success,
    ).toBe(false);
  });
  test("infrastructure recipes accept only the exact source-owned stacks and action", () => {
    expect(tofuApplyCommand({ stack: "cloudflare" })).toEqual([
      "bun",
      "--no-install",
      "packages/homelab/scripts/tofu/tofu-stack.ts",
      "cloudflare",
      "apply",
    ]);
    for (const stack of [
      "openai",
      "anthropic",
      "discord",
      "cloudflare-tokens",
      "argocd",
      "asuswrt",
      "application-secrets",
      "github;echo injected",
    ]) {
      expect(() => tofuApplyCommand({ stack })).toThrow();
    }
    expect(() =>
      tofuApplyCommand({ stack: "github", action: "destroy" }),
    ).toThrow();
  });
});
