import { afterEach, expect, test, vi } from "vitest";
import type { DependencyChange } from "#shared/deps-summary-types.ts";
import { internalBuildAttempt } from "./deps-summary-internal-build.ts";
import { ociMetadata } from "./deps-summary-oci.ts";

const previous = "1".repeat(40);
const revision = "2".repeat(40);
const source = "https://github.com/shepherdjerred/monorepo";
const change: DependencyChange = {
  name: "temporal-worker",
  category: "internal-image",
  artifactType: "image",
  datasource: "docker",
  registryUrl: "https://ghcr.io/shepherdjerred",
  packageName: undefined,
  oldValue: `1.0.0@sha256:${"a".repeat(64)}`,
  newValue: `2.0.0@sha256:${"b".repeat(64)}`,
  oldVersion: "1.0.0",
  newVersion: "2.0.0",
  kind: "internal-promotion",
  commitSha: "3".repeat(40),
  commitSubject: "chore: promote internal images",
  releaseNotesOverride: undefined,
};
afterEach(() => vi.unstubAllGlobals());

function buildEnvironment(
  sha: string,
  options: { missingRevision?: boolean; conflictingEnvironment?: boolean },
): string[] {
  if (options.missingRevision) return [];
  return [
    `GIT_SHA=${sha}`,
    ...(options.conflictingEnvironment ? [`GIT_SHA=${"4".repeat(40)}`] : []),
  ];
}

function mockRegistry(
  options: {
    source?: string;
    missingRevision?: boolean;
    mismatchedRevision?: boolean;
    conflictingEnvironment?: boolean;
    wrongBase?: boolean;
  } = {},
) {
  const requested: string[] = [];
  vi.stubGlobal("fetch", async (input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : input.toString();
    requested.push(url);
    if (url.includes("/manifests/")) {
      const old = url.endsWith("a".repeat(64));
      return Response.json({
        config: { digest: old ? "sha256:old" : "sha256:new" },
      });
    }
    if (url.includes("/blobs/")) {
      const sha = url.endsWith("old") ? previous : revision;
      return Response.json({
        config: {
          Labels: {
            "org.opencontainers.image.source": options.source ?? source,
            ...(options.mismatchedRevision
              ? { "org.opencontainers.image.revision": "4".repeat(40) }
              : {}),
          },
          Env: buildEnvironment(sha, options),
        },
      });
    }
    if (url.includes("/compare/"))
      return Response.json({
        status: "ahead",
        total_commits: 1,
        base_commit: {
          sha: options.wrongBase ? revision : previous,
          commit: { message: "Old build" },
        },
        commits: [
          {
            sha: revision,
            commit: {
              message: "fix(temporal): preserve digest outcomes\n\nDetails",
            },
          },
        ],
      });
    throw new Error(`Unexpected request: ${url}`);
  });
  return requested;
}

test("uses pinned image identities and actual build-source commits instead of promotion prose", async () => {
  const requested = mockRegistry();
  const result = await internalBuildAttempt(change, {
    Accept: "application/vnd.github+json",
  });
  expect(result.attempt.outcome).toBe("found");
  expect(result.note?.source).toBe("internal-build");
  expect(result.note?.notes).toContain("not upstream release notes");
  expect(result.note?.notes).toContain("preserve digest outcomes");
  expect(result.note?.url).toBe(`${source}/compare/${previous}...${revision}`);
  expect(requested.some((url) => url.endsWith("/manifests/2.0.0"))).toBe(false);
});

test("keeps missing build identity explicit", async () => {
  mockRegistry({ missingRevision: true, mismatchedRevision: true });
  const result = await internalBuildAttempt(change, {});
  expect(result.attempt.outcome).toBe("unavailable");
  expect(result.note).toBeUndefined();
});

test("uses the application's baked revision instead of an inherited base-image label", async () => {
  mockRegistry({ mismatchedRevision: true });
  const result = await internalBuildAttempt(change, {});
  expect(result.attempt.outcome).toBe("found");
  expect(result.note?.url).toBe(`${source}/compare/${previous}...${revision}`);
});

test("refuses another repository's revision as first-party build evidence", async () => {
  mockRegistry({ source: "https://github.com/somewhere/else" });
  const result = await internalBuildAttempt(change, {});
  expect(result.attempt.outcome).toBe("unavailable");
});

test("fails conflicting revision declarations and a mismatched comparison base", async () => {
  mockRegistry({ conflictingEnvironment: true });
  const conflicting = await internalBuildAttempt(change, {});
  expect(conflicting.attempt.outcome).toBe("failed");
  mockRegistry({ wrongBase: true });
  const wrongBase = await internalBuildAttempt(change, {});
  expect(wrongBase.attempt.outcome).toBe("failed");
});

test("reads revision metadata even when the manifest includes a description", async () => {
  vi.stubGlobal("fetch", async (input: string) =>
    Response.json(
      input.includes("/manifests/")
        ? {
            annotations: {
              "org.opencontainers.image.description":
                "Generic image description",
            },
            config: { digest: "sha256:config" },
          }
        : {
            config: {
              Labels: { "org.opencontainers.image.source": source },
              Env: [`GIT_SHA=${revision}`],
            },
          },
    ),
  );
  const metadata = await ociMetadata(
    "https://ghcr.io",
    "shepherdjerred/temporal-worker",
    `sha256:${"a".repeat(64)}`,
    { followIndex: true },
  );
  expect(metadata.revision).toBe(revision);
});

test.each([true, false])(
  "skips attestations and preserves index source identity (baked revision=%s)",
  async (bakedRevision) => {
    const requested: string[] = [];
    vi.stubGlobal("fetch", async (input: string) => {
      requested.push(input);
      if (input.endsWith("/manifests/index"))
        return Response.json({
          annotations: {
            "org.opencontainers.image.source": source,
            "org.opencontainers.image.revision": "4".repeat(40),
          },
          manifests: [
            {
              digest: "sha256:attestation",
              platform: { os: "unknown", architecture: "unknown" },
            },
            {
              digest: "sha256:image",
              platform: { os: "linux", architecture: "amd64" },
            },
          ],
        });
      if (input.endsWith("/manifests/sha256%3Aimage"))
        return Response.json({ config: { digest: "sha256:config" } });
      if (input.endsWith("/blobs/sha256:config"))
        return Response.json({
          config: {
            Labels: { "org.opencontainers.image.revision": "5".repeat(40) },
            Env: bakedRevision ? [`GIT_SHA=${revision}`] : [],
          },
        });
      throw new Error(`Unexpected registry request: ${input}`);
    });
    const metadata = await ociMetadata("https://ghcr.io", "app", "index", {
      followIndex: true,
    });
    expect(metadata.source).toBe(source);
    expect(metadata.revision).toBe(bakedRevision ? revision : undefined);
    expect(requested.some((url) => url.includes("attestation"))).toBe(false);
  },
);

test("fails an index containing only attestation metadata", async () => {
  vi.stubGlobal("fetch", async () =>
    Response.json({
      manifests: [
        {
          digest: "sha256:attestation",
          platform: { os: "unknown", architecture: "unknown" },
        },
      ],
    }),
  );
  await expect(
    ociMetadata("https://ghcr.io", "app", "index", { followIndex: true }),
  ).rejects.toThrow("no concrete image platform");
});
