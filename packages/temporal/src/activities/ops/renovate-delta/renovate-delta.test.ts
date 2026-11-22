import {
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import {
  initFeatureFlags,
  shutdownFeatureFlags,
} from "@shepherdjerred/feature-flags";
import { StaticProvider } from "@shepherdjerred/feature-flags/providers/static.ts";
import type {
  GitHubReleaseNote,
  OpenPullRequest,
  PullRequestBody,
} from "@shepherdjerred/ops-clients/github.ts";
import type { Fetch } from "@shepherdjerred/ops-clients/http.ts";
import { RenovateVersionDeltaSchema } from "@shepherdjerred/ops-model/facets.ts";
import { afterEach, describe, expect, test } from "vitest";
import { fetchCandidateChangelogEvidence } from "./changelog-fetcher.ts";
import {
  collectLiveClusterSnapshot,
  resolveRunningVersion,
  type LiveClusterSnapshot,
} from "./cluster-versions.ts";
import {
  isRenovateLlmDeltaEnabled,
  RENOVATE_LLM_DELTA_FLAG_KEY,
  synthesizeRenovateVersionDelta,
} from "./llm-synthesizer.ts";
import { parseRenovatePrBody } from "./pr-body-parser.ts";
import { resolveUpstreamRegistryInfo } from "./registry-resolver.ts";
import {
  parseCatalogManifest,
  parseMiseTomlManifest,
  parseRootPackageJsonManifest,
  parseTofuProvidersManifest,
  type RepoPinEntry,
} from "./repo-pins.ts";
import { runRenovateDeltaEnrichmentPipeline } from "./renovate-delta.ts";
import {
  computeDeltaCacheKey,
  createS3RenovateDeltaStore,
  RENOVATE_DELTA_LATEST_INDEX_KEY,
  RenovateDeltaIndexSchema,
  renovateDeltaItemKey,
  type RenovateDeltaStore,
  type S3ObjectSender,
} from "./s3-cache.ts";
import { resolveRenovateCandidates } from "./version-resolver.ts";

function requestUrl(input: string | URL | Request): string {
  if (typeof input === "string") {
    return input;
  }
  return input instanceof URL ? input.href : input.url;
}

const k8sRawFetch: Fetch = async (input) => {
  const url = requestUrl(input);
  if (url.includes("/api/v1/pods")) {
    return Response.json({
      items: [
        {
          spec: {
            containers: [{ image: "temporalio/server:1.32.2@sha256:7bf6" }],
          },
        },
      ],
    });
  }
  return Response.json({
    items: [
      {
        metadata: { name: "cert-manager" },
        spec: {
          source: { chart: "cert-manager", targetRevision: "v1.21.3" },
        },
        status: {
          sync: { revision: "v1.21.3" },
          summary: {
            images: ["quay.io/jetstack/cert-manager-controller:v1.21.3"],
          },
        },
      },
    ],
  });
};

const registryFakeFetch: Fetch = async (input) => {
  const url = requestUrl(input);
  if (url.startsWith("https://registry.npmjs.org/")) {
    return Response.json({
      description: "Async state management",
      repository: {
        url: "git+https://github.com/TanStack/query.git",
      },
    });
  }
  if (url.startsWith("https://crates.io/api/v1/crates/serde")) {
    return Response.json({
      crate: {
        description: "Serialization framework",
        repository: "https://github.com/serde-rs/serde",
      },
    });
  }
  if (url.startsWith("https://pypi.org/pypi/ruff/json")) {
    return Response.json({
      info: {
        summary: "Fast Python linter",
        project_urls: {
          Repository: "https://github.com/astral-sh/ruff",
        },
      },
    });
  }
  return new Response("not found", { status: 404 });
};

const notFoundFetch: Fetch = async () =>
  new Response("not found", { status: 404 });

function makeInMemoryStore(): {
  store: RenovateDeltaStore;
  objects: Map<string, string>;
} {
  const objects = new Map<string, string>();
  const client: S3ObjectSender = {
    send: async (command) => {
      if (command instanceof GetObjectCommand) {
        const key = command.input.Key ?? "";
        const raw = objects.get(key);
        if (raw === undefined) {
          throw new NoSuchKey({ $metadata: {}, message: "NoSuchKey" });
        }
        return {
          Body: {
            transformToString: async () => raw,
          },
        };
      }
      if (command instanceof PutObjectCommand) {
        const key = command.input.Key ?? "";
        const body =
          typeof command.input.Body === "string" ? command.input.Body : "";
        objects.set(key, body);
        return {};
      }
      throw new Error("Unsupported S3 command");
    },
  };
  const store = createS3RenovateDeltaStore({
    client,
    bucket: "llm-archive",
  });
  return { store, objects };
}

function makeSimpleMemoryStore(): {
  store: RenovateDeltaStore;
  items: Map<string, ReturnType<typeof RenovateVersionDeltaSchema.parse>>;
  latestIndex: ReturnType<typeof RenovateDeltaIndexSchema.parse> | undefined;
} {
  const state: {
    items: Map<string, ReturnType<typeof RenovateVersionDeltaSchema.parse>>;
    latestIndex: ReturnType<typeof RenovateDeltaIndexSchema.parse> | undefined;
  } = {
    items: new Map(),
    latestIndex: undefined,
  };
  const store: RenovateDeltaStore = {
    getItem: async (key) => state.items.get(key),
    putItem: async (delta) => {
      state.items.set(delta.cacheKey, RenovateVersionDeltaSchema.parse(delta));
    },
    getLatestIndex: async () => state.latestIndex,
    putLatestIndex: async (index) => {
      state.latestIndex = RenovateDeltaIndexSchema.parse(index);
    },
  };
  return {
    store,
    items: state.items,
    get latestIndex() {
      return state.latestIndex;
    },
  };
}

function sampleOpenPr(
  overrides: Partial<OpenPullRequest> = {},
): OpenPullRequest {
  return {
    number: 512,
    title: "chore(deps): update flipt-io/flipt docker tag to v2.16.0",
    url: "https://github.com/shepherdjerred/monorepo/pull/512",
    author: { login: "renovate", kind: "bot" },
    draft: false,
    createdAt: "2026-11-20T12:00:00Z",
    updatedAt: "2026-11-21T12:00:00Z",
    reviewDecision: null,
    mergeable: "MERGEABLE",
    branch: "renovate/flipt-2.x",
    baseRefName: "main",
    headOid: "abc123",
    exactHeadApproved: false,
    labels: [],
    checks: "SUCCESS",
    ...overrides,
  };
}

function buildSampleManifestMap(): Map<string, RepoPinEntry> {
  const byKey = new Map<string, RepoPinEntry>();
  parseCatalogManifest(
    JSON.stringify({
      entries: [
        {
          name: "flipt-io/flipt",
          value:
            "v2.14.2@sha256:121830e237c3a0d2b875f73905944d6ff301fdd7881c5abdec5f24f5549537e8",
          management: {
            managed: true,
            datasource: "docker",
            packageName: "flipt/flipt",
          },
        },
        {
          name: "argo-cd",
          value: "10.18.2",
          management: {
            managed: true,
            datasource: "helm",
          },
        },
      ],
    }),
    byKey,
  );
  parseRootPackageJsonManifest(
    JSON.stringify({
      packageManager: "bun@1.4.5",
      devDependencies: {
        prettier: "^3.9.9",
      },
    }),
    byKey,
  );
  parseMiseTomlManifest(
    [
      "[tools]",
      'bun = "1.4.5"',
      '"aqua:temporalio/cli" = "1.10.1"',
      "# renovate: datasource=github-releases depName=corretto/corretto-25 versioning=loose",
      'java = "corretto-25.0.5.1.2"',
    ].join("\n"),
    byKey,
  );
  parseTofuProvidersManifest(
    JSON.stringify({
      providers: [
        {
          registryUrl: "https://registry.opentofu.org",
          source: "hashicorp/aws",
          version: "6.68.0",
        },
      ],
    }),
    byKey,
  );
  return byKey;
}

describe("Renovate version-delta dual resolver & manifests", () => {
  test("resolves live cluster versions across pods, Argo charts, kubelet, and Talos", () => {
    const byKey = buildSampleManifestMap();
    const cluster: LiveClusterSnapshot = {
      podImages: [
        "docker.io/flipt-io/flipt:v2.13.0@sha256:9999999999999999999999999999999999999999999999999999999999999999",
      ],
      argoImages: [],
      argoChartVersions: new Map([["argo-cd", "10.17.0"]]),
      kubeletVersion: "1.34.1",
      talosVersion: "1.11.5",
    };

    expect(
      resolveRunningVersion({
        packageName: "flipt-io/flipt",
        aliases: byKey.get("flipt-io/flipt")?.aliases ?? [],
        ecosystem: "docker",
        snapshot: cluster,
      }),
    ).toBe("2.13.0");
    expect(
      resolveRunningVersion({
        packageName: "argo-cd",
        ecosystem: "helm",
        snapshot: cluster,
      }),
    ).toBe("10.17.0");
    expect(
      resolveRunningVersion({
        packageName: "kubernetes/kubernetes",
        snapshot: cluster,
      }),
    ).toBe("1.34.1");
    expect(
      resolveRunningVersion({
        packageName: "ghcr.io/siderolabs/installer",
        snapshot: cluster,
      }),
    ).toBe("1.11.5");
  });

  test("resolves candidates combining dashboard #481, open PRs, manifests, and cluster drift", () => {
    const byKey = buildSampleManifestMap();
    const cluster: LiveClusterSnapshot = {
      podImages: [
        "docker.io/flipt-io/flipt:v2.13.0@sha256:9999999999999999999999999999999999999999999999999999999999999999",
      ],
      argoImages: [],
      argoChartVersions: new Map([["argo-cd", "10.17.0"]]),
      kubeletVersion: "1.34.1",
      talosVersion: "1.11.5",
    };
    const dashboardBody = [
      "## Pending Approval",
      "- [ ] <!-- approve-branch=renovate/argo-cd-10.x -->chore(deps): update helm release argo-cd to v10.19.0",
      "- [ ] <!-- approve-branch=renovate/aws-6.x -->chore(deps): update terraform hashicorp/aws to v6.70.0",
      "- [ ] <!-- approve-branch=renovate/temporal-cli -->chore(deps): update aqua:temporalio/cli to v1.12.0",
    ].join("\n");

    const prBodyMap = new Map<number, PullRequestBody>([
      [
        512,
        {
          number: 512,
          title: "chore(deps): update flipt-io/flipt docker tag to v2.16.0",
          headRefName: "renovate/flipt-2.x",
          url: "https://github.com/shepherdjerred/monorepo/pull/512",
          body: [
            "| Package | Change |",
            "| --- | --- |",
            "| [flipt-io/flipt](https://github.com/flipt-io/flipt) | [`v2.14.2` -> `v2.16.0`](https://github.com/flipt-io/flipt/compare/v2.14.2...v2.16.0) |",
            "",
            "Touched `packages/feature-flags/src/index.ts`.",
          ].join("\n"),
        },
      ],
    ]);

    const candidates = resolveRenovateCandidates({
      dashboardBody,
      openPullRequests: [sampleOpenPr()],
      pullRequestBodies: prBodyMap,
      manifests: { byKey },
      cluster,
    });

    expect(candidates).toHaveLength(4);
    const flipt = candidates.find((c) => c.branch === "renovate/flipt-2.x");
    expect(flipt).toMatchObject({
      packageName: "flipt-io/flipt",
      runningVersion: "2.13.0",
      pinnedVersion: "2.14.2",
      effectiveFromVersion: "2.13.0",
      targetVersion: "2.16.0",
      versionsBehindCount: 3,
      priorityRank: 0,
      consumers: [
        "packages/feature-flags",
        "packages/homelab",
        "version-catalog",
      ],
    });

    const aws = candidates.find((c) => c.branch === "renovate/aws-6.x");
    expect(aws).toMatchObject({
      packageName: "hashicorp/aws",
      runningVersion: null,
      pinnedVersion: "6.68.0",
      effectiveFromVersion: "6.68.0",
      targetVersion: "6.70.0",
      consumers: ["packages/homelab", "packages/homelab-cdktn"],
      priorityRank: 1,
    });
  });

  test("collects live cluster pod images, Argo chart versions, kubelet, and Talos from Kubernetes APIs", async () => {
    const snapshot = await collectLiveClusterSnapshot({
      kubernetes: {
        listNodes: async () => [
          {
            name: "torvalds",
            ready: true,
            readySince: "2026-11-01T00:00:00Z",
            osImage: "Talos (v1.11.5)",
            kubeletVersion: "v1.34.1",
          },
        ],
        listPods: async () => [],
        listArgoApplications: async () => [],
      },
      rawApi: {
        baseUrl: "https://kubernetes.default.svc:443",
        token: async () => "test-sa-token",
        fetchImpl: k8sRawFetch,
      },
    });

    expect(snapshot.kubeletVersion).toBe("1.34.1");
    expect(snapshot.talosVersion).toBe("1.11.5");
    expect(snapshot.argoChartVersions.get("cert-manager")).toBe("1.21.3");
    expect(
      resolveRunningVersion({
        packageName: "temporalio/server",
        ecosystem: "docker",
        snapshot,
      }),
    ).toBe("1.32.2");
  });

  test("parses Renovate PR body markdown table and release notes block", () => {
    const parsed = parseRenovatePrBody(
      [
        "This PR contains the following updates:",
        "",
        "| Package | Type | Update | Change |",
        "|---|---|---|---|",
        "| [@tanstack/query](https://github.com/TanStack/query) | dependencies | minor | [`5.60.0` -> `5.64.0`](https://github.com/TanStack/query/compare/v5.60.0...v5.64.0) |",
        "",
        "<details>",
        "<summary>Release Notes</summary>",
        "### v5.64.0",
        "- Added query cancellation telemetry hook for SSR consumers.",
        "</details>",
      ].join("\n"),
    );

    expect(parsed.changes).toEqual([
      {
        packageName: "@tanstack/query",
        fromVersion: "5.60.0",
        toVersion: "5.64.0",
        compareUrl:
          "https://github.com/TanStack/query/compare/v5.60.0...v5.64.0",
        upstreamGithubRepo: "TanStack/query",
      },
    ]);
    expect(parsed.releaseNotesExcerpt).toContain("v5.64.0");
  });
});

describe("Multi-registry cumulative changelog & compare diff fetcher", () => {
  test("resolves npm scoped packages, crates.io, PyPI, and OpenTofu providers to GitHub owner/repo", async () => {
    const baseCandidate = {
      branch: "renovate/test",
      title: "update",
      targetVersion: "2.0.0",
      runningVersion: null,
      pinnedVersion: "1.0.0",
      effectiveFromVersion: "1.0.0",
      versionsBehindCount: 1,
      consumers: [],
      updateType: "major" as const,
      state: "awaiting-approval" as const,
      isOpenPr: false,
      priorityRank: 1,
      cacheKey: "abc",
    };

    const npmInfo = await resolveUpstreamRegistryInfo({
      candidate: {
        ...baseCandidate,
        packageName: "@tanstack/query",
        ecosystem: "npm",
      },
      fetchImpl: registryFakeFetch,
    });
    expect(npmInfo.githubRepo).toEqual({ owner: "TanStack", name: "query" });

    const crateInfo = await resolveUpstreamRegistryInfo({
      candidate: {
        ...baseCandidate,
        packageName: "serde",
        ecosystem: "rust",
      },
      fetchImpl: registryFakeFetch,
    });
    expect(crateInfo.githubRepo).toEqual({ owner: "serde-rs", name: "serde" });

    const pypiInfo = await resolveUpstreamRegistryInfo({
      candidate: {
        ...baseCandidate,
        packageName: "ruff",
        ecosystem: "python",
      },
      fetchImpl: registryFakeFetch,
    });
    expect(pypiInfo.githubRepo).toEqual({ owner: "astral-sh", name: "ruff" });

    const tofuInfo = await resolveUpstreamRegistryInfo({
      candidate: {
        ...baseCandidate,
        packageName: "hashicorp/aws",
        ecosystem: "terraform",
      },
      fetchImpl: registryFakeFetch,
    });
    expect(tofuInfo.githubRepo).toEqual({
      owner: "hashicorp",
      name: "terraform-provider-aws",
    });
  });

  test("fetches cumulative releases strictly in (effectiveFromVersion, targetVersion] and falls back to compareCommits", async () => {
    const releases: GitHubReleaseNote[] = [
      {
        tagName: "v2.17.0-rc.1",
        name: "v2.17.0-rc.1",
        body: "Prerelease should be excluded",
        url: "https://github.com/flipt-io/flipt/releases/tag/v2.17.0-rc.1",
        prerelease: true,
        publishedAt: "2026-11-21T00:00:00Z",
      },
      {
        tagName: "v2.16.0",
        name: "v2.16.0",
        body: "- Added OIDC token caching",
        url: "https://github.com/flipt-io/flipt/releases/tag/v2.16.0",
        prerelease: false,
        publishedAt: "2026-11-20T00:00:00Z",
      },
      {
        tagName: "v2.15.0",
        name: "v2.15.0",
        body: "BREAKING CHANGE: Removed deprecated v1 grpc flag endpoint",
        url: "https://github.com/flipt-io/flipt/releases/tag/v2.15.0",
        prerelease: false,
        publishedAt: "2026-11-15T00:00:00Z",
      },
      {
        tagName: "v2.14.0",
        name: "v2.14.0",
        body: "- Added snapshot ETag header",
        url: "https://github.com/flipt-io/flipt/releases/tag/v2.14.0",
        prerelease: false,
        publishedAt: "2026-11-10T00:00:00Z",
      },
      {
        tagName: "v2.13.0",
        name: "v2.13.0",
        body: "Already running in cluster; must NOT be included",
        url: "https://github.com/flipt-io/flipt/releases/tag/v2.13.0",
        prerelease: false,
        publishedAt: "2026-11-01T00:00:00Z",
      },
    ];

    const candidate = {
      branch: "renovate/flipt-2.x",
      title: "update flipt",
      packageName: "flipt-io/flipt",
      targetVersion: "2.16.0",
      runningVersion: "2.13.0",
      pinnedVersion: "2.14.0",
      effectiveFromVersion: "2.13.0",
      versionsBehindCount: 3,
      consumers: ["version-catalog", "packages/homelab"],
      ecosystem: "docker",
      updateType: "minor" as const,
      state: "pending-checks" as const,
      isOpenPr: true,
      priorityRank: 0,
      cacheKey: computeDeltaCacheKey({
        packageName: "flipt-io/flipt",
        effectiveFromVersion: "2.13.0",
        targetVersion: "2.16.0",
        consumers: ["version-catalog", "packages/homelab"],
      }),
    };

    const cumulative = await fetchCandidateChangelogEvidence({
      candidate,
      github: {
        releasesBetween: async () => releases,
        compareCommits: async () => {
          throw new Error("should not call compareCommits when releases exist");
        },
      },
    });

    expect(cumulative.evidenceSource).toBe("github-releases");
    expect(cumulative.intermediateReleaseCount).toBe(3);
    expect(cumulative.text).toContain("v2.14.0");
    expect(cumulative.text).toContain("v2.15.0");
    expect(cumulative.text).toContain("v2.16.0");
    expect(cumulative.text).not.toContain("v2.13.0");
    expect(cumulative.text).not.toContain("v2.17.0-rc.1");
    expect(cumulative.releaseUrls).toEqual([
      "https://github.com/flipt-io/flipt/releases/tag/v2.14.0",
      "https://github.com/flipt-io/flipt/releases/tag/v2.15.0",
      "https://github.com/flipt-io/flipt/releases/tag/v2.16.0",
    ]);

    const compareFallback = await fetchCandidateChangelogEvidence({
      candidate,
      github: {
        releasesBetween: async () => [],
        compareCommits: async ({ base, head }) => ({
          aheadBy: 2,
          htmlUrl: `https://github.com/flipt-io/flipt/compare/${base}...${head}`,
          commits: [
            {
              sha: "111",
              headline: "feat: support snapshot compression",
              committedAt: "2026-11-19T00:00:00Z",
            },
          ],
        }),
      },
    });

    expect(compareFallback.evidenceSource).toBe("github-compare");
    expect(compareFallback.compareUrl).toBe(
      "https://github.com/flipt-io/flipt/compare/v2.13.0...v2.16.0",
    );
    expect(compareFallback.text).toContain("support snapshot compression");
  });
});

function makePriorityPipelineDependencies(options: {
  readonly store: RenovateDeltaStore;
  readonly fixedNow: Date;
  readonly synthesizedOrder: string[];
  readonly includeReleases: boolean;
}) {
  const dashboardBody = [
    "## Rate-Limited",
    "- [ ] <!-- unlimit-branch=renovate/rate-limited-pkg -->chore(deps): update dependency pkg-rate to v1.2.0",
    "## Errored",
    "- [ ] <!-- retry-branch=renovate/errored-pkg -->chore(deps): update dependency pkg-err to v2.0.0",
    "## Pending Approval",
    "- [ ] <!-- approve-branch=renovate/approval-pkg -->chore(deps): update dependency pkg-approve to v3.1.0",
  ].join("\n");

  const openPr = sampleOpenPr({
    number: 600,
    branch: "renovate/open-pr-pkg",
    title: "chore(deps): update dependency pkg-open to v4.0.0",
  });

  return {
    isFlagEnabled: async () => true,
    store: options.store,
    now: () => options.fixedNow,
    maxMissesPerRun: 3,
    loadManifests: async () => ({
      byKey: new Map([
        [
          "pkg-open",
          {
            pinnedVersion: "3.0.0",
            consumers: ["package.json"],
            aliases: ["pkg-open"],
          },
        ],
      ]),
    }),
    loadClusterSnapshot: async () => ({
      podImages: [],
      argoImages: [],
      argoChartVersions: new Map(),
      kubeletVersion: null,
      talosVersion: null,
    }),
    github: {
      openIssueByTitle: async () => ({
        number: 481,
        url: "https://github.com/shepherdjerred/monorepo/issues/481",
        body: dashboardBody,
      }),
      openPullRequests: async () => [openPr],
      pullRequestBody: async (num: number) => ({
        number: num,
        title: openPr.title,
        headRefName: openPr.branch,
        url: openPr.url,
        body: "| Package | Change |\n|---|---|\n| [pkg-open](https://github.com/acme/pkg-open) | `3.0.0` -> `4.0.0` |",
      }),
      releasesBetween: async ({ name }: { name: string }) =>
        options.includeReleases
          ? [
              {
                tagName: "v4.0.0",
                name: `${name} v4.0.0`,
                body: "- Major V4 rewrite with faster parser",
                url: `https://github.com/acme/${name}/releases/tag/v4.0.0`,
                prerelease: false,
                publishedAt: "2026-11-20T00:00:00Z",
              },
            ]
          : [],
      compareCommits: async () => ({
        aheadBy: 0,
        htmlUrl: "https://github.com/acme/pkg/compare/v1...v2",
        commits: [],
      }),
    },
    fetchImpl: notFoundFetch,
    generateLlmText: async (prompt: string) => {
      const match = /"packageName":"([^"]+)"/u.exec(prompt);
      options.synthesizedOrder.push(match?.[1] ?? "unknown");
      return JSON.stringify({
        summary:
          "Upgrades package to the latest stable version with parser improvements.",
        impactLevel: "high",
        breakingChanges: [],
        highlights: ["Faster parser"],
        repoRelevance: "Consumed by root package.json.",
      });
    },
  };
}

describe("Flipt flag gating, LLM synthesis fallback, and S3 pipeline", () => {
  afterEach(async () => {
    await shutdownFeatureFlags();
  });

  test("gates on temporal-renovate-llm-delta-enabled via StaticProvider and defaults on when unset", async () => {
    await initFeatureFlags({
      provider: new StaticProvider({
        [RENOVATE_LLM_DELTA_FLAG_KEY]: false,
      }),
      environment: { FEATURE_FLAGS_MODE: "static" },
    });
    expect(
      await isRenovateLlmDeltaEnabled({ FEATURE_FLAGS_MODE: "static" }),
    ).toBe(false);

    const memory = makeSimpleMemoryStore();
    const skippedRun = await runRenovateDeltaEnrichmentPipeline({
      store: memory.store,
      isFlagEnabled: () =>
        isRenovateLlmDeltaEnabled({ FEATURE_FLAGS_MODE: "static" }),
    });
    expect(skippedRun).toEqual({ skipped: true, reason: "flag-disabled" });

    await initFeatureFlags({
      provider: new StaticProvider({}),
      environment: { FEATURE_FLAGS_MODE: "static" },
    });
    expect(
      await isRenovateLlmDeltaEnabled({ FEATURE_FLAGS_MODE: "static" }),
    ).toBe(true);
  });

  test("falls back deterministically when LLM output is invalid or throws", async () => {
    const candidate = {
      branch: "renovate/flipt-2.x",
      title: "update flipt",
      packageName: "flipt-io/flipt",
      targetVersion: "2.16.0",
      runningVersion: "2.13.0",
      pinnedVersion: "2.14.2",
      effectiveFromVersion: "2.13.0",
      versionsBehindCount: 3,
      consumers: ["packages/homelab", "version-catalog"],
      ecosystem: "docker",
      updateType: "minor" as const,
      state: "pending-checks" as const,
      isOpenPr: true,
      priorityRank: 0,
      cacheKey: computeDeltaCacheKey({
        packageName: "flipt-io/flipt",
        effectiveFromVersion: "2.13.0",
        targetVersion: "2.16.0",
        consumers: ["packages/homelab", "version-catalog"],
      }),
    };

    const delta = await synthesizeRenovateVersionDelta({
      candidate,
      evidence: {
        evidenceSource: "github-releases",
        text: "BREAKING CHANGE: Removed legacy v1 evaluation endpoint\n- Added OIDC caching",
        compareUrl:
          "https://github.com/flipt-io/flipt/compare/v2.13.0...v2.16.0",
        releaseUrls: ["https://github.com/flipt-io/flipt/releases/tag/v2.16.0"],
        intermediateReleaseCount: 3,
      },
      now: new Date("2026-11-21T22:00:00.000Z"),
      generateLlmText: async () => {
        throw new Error("provider quota temporarily exhausted");
      },
    });

    expect(delta.impactLevel).toBe("breaking");
    expect(delta.breakingChanges.length).toBeGreaterThan(0);
    expect(delta.repoRelevance).toContain("packages/homelab");
    expect(delta.repoRelevance).toContain("version-catalog");
    expect(delta.versionsBehindCount).toBe(3);
  });

  test("persists items and latest-index.json to S3, reuses cache hits, and enforces priority + miss cap", async () => {
    const { store, objects } = makeInMemoryStore();
    const fixedNow = new Date("2026-11-21T22:30:00.000Z");

    const firstOrder: string[] = [];
    const firstRun = await runRenovateDeltaEnrichmentPipeline(
      makePriorityPipelineDependencies({
        store,
        fixedNow,
        synthesizedOrder: firstOrder,
        includeReleases: true,
      }),
    );

    expect(firstRun).toEqual({
      skipped: false,
      updatedAt: "2026-11-21T22:30:00.000Z",
      totalCandidates: 4,
      cacheHits: 0,
      synthesizedCount: 3,
      deferredMisses: 1,
      indexedBranches: 3,
    });
    expect(firstOrder).toEqual(["pkg-open", "pkg-approve", "pkg-err"]);

    const rawIndex = objects.get(RENOVATE_DELTA_LATEST_INDEX_KEY);
    expect(rawIndex).toBeDefined();
    const parsedIndex = RenovateDeltaIndexSchema.parse(
      JSON.parse(rawIndex ?? "{}"),
    );
    expect(Object.keys(parsedIndex.deltasByBranch).toSorted()).toEqual([
      "renovate/approval-pkg",
      "renovate/errored-pkg",
      "renovate/open-pr-pkg",
    ]);
    const openDelta = parsedIndex.deltasByBranch["renovate/open-pr-pkg"];
    expect(openDelta).toBeDefined();
    expect(objects.has(renovateDeltaItemKey(openDelta?.cacheKey ?? ""))).toBe(
      true,
    );

    const secondOrder: string[] = [];
    const secondRun = await runRenovateDeltaEnrichmentPipeline(
      makePriorityPipelineDependencies({
        store,
        fixedNow,
        synthesizedOrder: secondOrder,
        includeReleases: false,
      }),
    );

    expect(secondRun).toEqual({
      skipped: false,
      updatedAt: "2026-11-21T22:30:00.000Z",
      totalCandidates: 4,
      cacheHits: 3,
      synthesizedCount: 1,
      deferredMisses: 0,
      indexedBranches: 4,
    });
    expect(secondOrder).toEqual(["pkg-rate"]);
  });
});
