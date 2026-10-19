import { describe, expect, test, vi } from "vitest";
import { rm } from "node:fs/promises";
import path from "node:path";
import * as canonicalRoot from "homelab/scripts/argocd/argocd.ts";
import { HOMELAB_RELEASE_RESULT_FILE } from "homelab/scripts/argocd/argocd-release-result.ts";
import { ArtifactVersionSchema } from "@shepherdjerred/delivery/contract";
import {
  RootReleaseInputSchema,
  run as runRootRelease,
  verifyRootJobResult,
} from "#scripts/jobs/root-release.ts";
import { deliveryTofuGrants } from "homelab/src/delivery-platform-grants.ts";

// Canonical protocol boundaries are exercised through the real Bun library in
// the homelab tests; this suite checks the native recipe's wiring and receipts.
vi.mock("homelab/scripts/argocd/argocd.ts", () => ({ releaseRoot: vi.fn() }));

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

test("root recipe verifies archive bytes, binds direct canonical admission, and validates the actual receipt", async () => {
  const bytes = "immutable chart bytes";
  const selected = {
    ...artifact,
    digest: `sha256:${new Bun.CryptoHasher("sha256").update(bytes).digest("hex")}`,
  };
  const frozen = { ...input, charts: [{ name: "apps", artifact: selected }] };
  const request = {
    deploymentId: "root/123",
    stageKey: "root-release",
    recipe: "root-release" as const,
    runnerImage: "runner@sha256:" + "b".repeat(64),
    sourceRevision: selected.sourceRevision,
    input: frozen,
  };
  const resultPath = path.resolve(
    import.meta.dirname,
    "../../../../..",
    HOMELAB_RELEASE_RESULT_FILE,
  );
  expect(await Bun.file(resultPath).exists()).toBe(false);
  const admit = vi.fn(async () => ({ admitted: true }));
  const canonical = vi
    .spyOn(canonicalRoot, "releaseRoot")
    .mockImplementation(async (...args) => {
      const [
        app,
        inventoryPath,
        revision,
        requestId,
        _timeout,
        dryRun,
        authority,
        resultFile,
      ] = args;
      expect({ app, revision, requestId, dryRun }).toEqual({
        app: "apps",
        revision: selected.version,
        requestId: input.requestId,
        dryRun: false,
      });
      expect(authority?.inventory).toEqual(
        await Bun.file(inventoryPath).json(),
      );
      expect(authority?.requestId).toBe(requestId);
      expect(authority?.revision).toBe(revision);
      expect(resultFile).toBe(resultPath);
      await authority?.authorize();
      await Bun.write(
        resultPath,
        JSON.stringify({
          schema: "homelab-release-result/v1",
          outcome: "applied-verified",
          rootApplication: "apps",
          requestId,
          revision,
          terminalOperationState: "terminated-after-applied",
          finalHealth: "all-expected-child-applications-synced-healthy",
          resourceIdentities: ["argoproj.io/Application/argocd/apps"],
          applications: [{ name: "apps", revision }],
        }),
      );
    });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(bytes)),
  );
  try {
    await expect(
      runRootRelease(
        {
          ...request,
          input: {
            ...frozen,
            charts: [
              {
                name: "apps",
                artifact: { ...selected, digest: artifact.digest },
              },
            ],
          },
        },
        admit,
      ),
    ).rejects.toThrow("chart bytes differ");
    expect(canonical).not.toHaveBeenCalled();
    expect(admit).not.toHaveBeenCalled();
    await expect(runRootRelease(request, admit)).resolves.toMatchObject({
      outcome: "applied-verified",
      requestId: input.requestId,
    });
    expect(canonical).toHaveBeenCalledTimes(1);
    expect(admit).toHaveBeenCalledTimes(1);
    await rm(resultPath);
    canonical.mockImplementationOnce(async () => {
      await Bun.write(resultPath, JSON.stringify({ outcome: "superseded" }));
    });
    await expect(runRootRelease(request, admit)).rejects.toThrow();
  } finally {
    canonical.mockRestore();
    vi.unstubAllGlobals();
    await rm(resultPath, { force: true });
  }
});

describe("reviewed isolated deployment Job recipes", () => {
  test("root acceptance requires the exact guarded applied receipt, never a zero-exit superseded or unrelated release", () => {
    const receipt = {
      schema: "homelab-release-result/v1",
      outcome: "applied-verified",
      rootApplication: "apps",
      requestId: input.requestId,
      revision: artifact.version,
      terminalOperationState: "terminated-after-applied",
      finalHealth: "all-expected-child-applications-synced-healthy",
      resourceIdentities: ["argoproj.io/Application/argocd/apps"],
      applications: [{ name: "apps", revision: artifact.version }],
    };
    expect(() => verifyRootJobResult(receipt, input)).not.toThrow();
    for (const changed of [
      { ...receipt, outcome: "superseded" },
      { ...receipt, requestId: crypto.randomUUID() },
      { ...receipt, applications: [{ name: "apps", revision: "2.0.0-999" }] },
    ])
      expect(() => verifyRootJobResult(changed, input)).toThrow();
  });
  test("root recipe rejects duplicates, moving revisions, foreign archives, and caller-selected pruning", () => {
    expect(
      RootReleaseInputSchema.safeParse({
        ...input,
        charts: [
          ...input.charts,
          {
            name: "temporal",
            artifact: {
              ...artifact,
              id: "temporal/1",
              component: "chart:temporal",
              uri: "https://chartmuseum.tailnet-1a49.ts.net/charts/temporal-2.0.0-123.tgz",
            },
          },
        ],
      }).success,
    ).toBe(false);
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
    expect(deliveryTofuGrants("cloudflare")).toContainEqual({
      env: "CLOUDFLARE_API_TOKEN",
      secret: "ci-cloudflare-credentials",
      key: "CLOUDFLARE_API_TOKEN",
    });
    for (const stack of [
      "argocd",
      "asuswrt",
      "application-secrets",
      "github;echo injected",
    ]) {
      expect(() => deliveryTofuGrants(stack)).toThrow();
    }
    expect(() =>
      deliveryTofuGrants({ stack: "github", action: "destroy" }),
    ).toThrow();
  });
});
