import { expect, test } from "vitest";
import {
  findGeneratedStep,
  readGeneratedSteps,
} from "../lib/ci/generated-steps.ts";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  computeReleaseInputDigest,
  hashReleaseInputFiles,
  writeScoutReleaseState,
  parseScoutPreparationArgs,
} from "./scout-site-release.ts";
import { selectPostHogSite } from "../lib/scout/scout-analytics-config.ts";
import {
  parseLegacyScoutReleaseManifest,
  parseScoutReleaseState,
  retagScoutReleaseState,
  resolveBackendDigest,
  resolveProdPin,
  siteReleaseIdentity,
  validateProdPinState,
} from "../lib/scout/scout-release-state.ts";
import { hashSiteArchive } from "../lib/scout/scout-archive.ts";

const DIGEST =
  "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

test("Scout archive preparation freezes its exact backend and dedicated scratch", () => {
  const input = [
    "prepare-state",
    "--build-number",
    "42",
    "--backend-digest",
    DIGEST,
    "--output",
    ".scout-release/state.json",
  ];
  const legacy = parseScoutPreparationArgs(input);
  expect(legacy.workDirectory).toBe(".delivery-artifacts/scout-release");
  const fresh = `sha256:${"b".repeat(64)}`;
  const delivery = parseScoutPreparationArgs([
    "prepare-state",
    "--delivery-archive",
    "--build-number",
    "42",
    "--backend-digest",
    fresh,
    "--output",
    ".delivery-artifacts/scout-release/state.json",
  ]);
  expect(delivery.workDirectory).toBe(".delivery-artifacts/scout-release");
  expect(delivery.backendImageDigest).toBe(fresh);
  expect(legacy.backendImageDigest).toBe(DIGEST);
  expect(() => parseScoutPreparationArgs([...input, "--unknown"])).toThrow();
  expect(() =>
    parseScoutPreparationArgs([...input, "--delivery-archive=false"]),
  ).toThrow();
});

const POSTHOG_REGISTRY = {
  provider: "posthog",
  projectToken: "phc_test",
  apiHost: "https://us.i.posthog.com",
  assetHost: "https://us-assets.i.posthog.com",
  proxyHost: "https://j.sjer.red",
  sites: [
    {
      key: "scout-prod",
      hostname: "scout-for-lol.com",
      sessionReplay: true,
      marketing: {
        pinterestTagId: "pin-1",
        redditPixelId: "reddit-1",
      },
    },
    {
      key: "scout-beta",
      hostname: "beta.scout-for-lol.com",
      sessionReplay: true,
    },
  ],
};

function stateJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schema: "scout-release-state/v1",
    buildNumber: 42,
    version: "2.0.0-42",
    sourceCommit: "0123456789012345678901234567890123456789",
    backendImageDigest: DIGEST,
    siteArchiveDigest: DIGEST,
    betaSiteArchiveDigest: DIGEST,
    releaseInputDigest: DIGEST,
    ...overrides,
  });
}

function versionCatalogSource(name: string, value: string): string {
  return JSON.stringify({
    $schema: "./schema.json",
    schemaVersion: 1,
    entries: [
      {
        name,
        value,
        category: "internal-image",
        artifactType: "image",
        management: { managed: false },
      },
    ],
  });
}

test("strict Scout release state binds version to build number", () => {
  const state = parseScoutReleaseState(stateJson());
  expect(state.version).toBe("2.0.0-42");
  expect(siteReleaseIdentity(state)).toBe(`scout-site@${DIGEST}`);
  expect(siteReleaseIdentity(state)).not.toBe(state.version);
  expect(() =>
    parseScoutReleaseState(stateJson({ version: "2.0.0-41" })),
  ).toThrow("does not match");
  expect(() =>
    parseScoutReleaseState(stateJson({ unexpected: true })),
  ).toThrow();
});

test("legacy Scout release manifests remain strict during prod migration", () => {
  expect(
    parseLegacyScoutReleaseManifest(
      JSON.stringify({
        version: "2.0.0-6673",
        gitSha: "24e5a5ebe4302e6dc99efc1c3706e7541d9b33dc",
        builtAt: "2026-07-28T06:48:43.491Z",
      }),
    ),
  ).toEqual({
    version: "2.0.0-6673",
    gitSha: "24e5a5ebe4302e6dc99efc1c3706e7541d9b33dc",
    builtAt: "2026-07-28T06:48:43.491Z",
  });
  expect(() =>
    parseLegacyScoutReleaseManifest(
      JSON.stringify({
        version: "2.0.0-6673",
        gitSha: "24e5a5ebe4302e6dc99efc1c3706e7541d9b33dc",
        builtAt: "not-a-timestamp",
      }),
    ),
  ).toThrow();
});

test("reused Scout content receives the current build version", () => {
  const existing = parseScoutReleaseState(stateJson());
  const alias = retagScoutReleaseState(existing, 100);
  expect(alias.buildNumber).toBe(100);
  expect(alias.version).toBe("2.0.0-100");
  expect(alias.sourceCommit).toBe(existing.sourceCommit);
  expect(alias.backendImageDigest).toBe(existing.backendImageDigest);
  expect(alias.siteArchiveDigest).toBe(existing.siteArchiveDigest);
  expect(alias.betaSiteArchiveDigest).toBe(existing.betaSiteArchiveDigest);
  expect(alias.releaseInputDigest).toBe(existing.releaseInputDigest);
  expect(siteReleaseIdentity(alias)).toBe(siteReleaseIdentity(existing));
});

test("backend digest prefers a candidate and otherwise uses the exact beta pin", () => {
  const other =
    "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const source = versionCatalogSource(
    "shepherdjerred/scout-for-lol/beta",
    `2.0.0-1@${DIGEST}`,
  );
  expect(resolveBackendDigest(other, source)).toBe(other);
  expect(resolveBackendDigest(null, source)).toBe(DIGEST);
  expect(() => resolveBackendDigest("latest", source)).toThrow("canonical");
});

test("production promotion state must match both tagged version and digest", () => {
  const state = parseScoutReleaseState(stateJson());
  expect(() => validateProdPinState(`2.0.0-42@${DIGEST}`, state)).not.toThrow();
  expect(() =>
    validateProdPinState(
      "2.0.0-42@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      state,
    ),
  ).toThrow("does not match");
  expect(() => validateProdPinState(`2.0.0-41@${DIGEST}`, state)).toThrow(
    "does not match",
  );
});

test("backend CLI resolves a retained publication instead of the checkout pin", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "scout-retained-backend-"));
  try {
    const catalogFile = path.join(dir, "version-catalog.json");
    await Bun.write(
      catalogFile,
      versionCatalogSource(
        "shepherdjerred/scout-for-lol/beta",
        `2.0.0-8864@${DIGEST}`,
      ),
    );
    const child = Bun.spawn(
      [
        "bun",
        new URL("scout-site-release.ts", import.meta.url).pathname,
        "resolve-backend-digest",
        "--version-catalog-file",
        catalogFile,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe(DIGEST);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("production pin resolution returns only the exact canonical pin", () => {
  const source = versionCatalogSource(
    "shepherdjerred/scout-for-lol/prod",
    `2.0.0-42@${DIGEST}`,
  );
  expect(resolveProdPin(source)).toBe(`2.0.0-42@${DIGEST}`);
  expect(() =>
    resolveProdPin(
      versionCatalogSource("shepherdjerred/scout-for-lol/prod", "latest"),
    ),
  ).toThrow("not canonical");
});

test("archive digest includes sorted paths and bytes", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "scout-archive-"));
  try {
    await mkdir(path.join(dir, "nested"));
    await Bun.write(path.join(dir, "nested", "b.txt"), "b");
    await Bun.write(path.join(dir, "a.txt"), "a");
    const first = await hashSiteArchive(dir);
    const second = await hashSiteArchive(dir);
    expect(first).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(second).toBe(first);
    await Bun.write(path.join(dir, "a.txt"), "changed");
    expect(await hashSiteArchive(dir)).not.toBe(first);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("release source digest changes only with selected input content", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "scout-release-inputs-"));
  try {
    await Bun.write(path.join(dir, "selected.txt"), "selected");
    await Bun.write(path.join(dir, "unrelated.txt"), "unrelated");
    const first = await hashReleaseInputFiles(dir, ["selected.txt"]);
    await Bun.write(path.join(dir, "unrelated.txt"), "changed");
    expect(await hashReleaseInputFiles(dir, ["selected.txt"])).toBe(first);
    await Bun.write(path.join(dir, "selected.txt"), "changed");
    expect(await hashReleaseInputFiles(dir, ["selected.txt"])).not.toBe(first);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("release input digest binds to the source commit and displayed version", () => {
  const base = {
    version: "2.0.0-42",
    sourceCommit: "0123456789012345678901234567890123456789",
    backendImageDigest: DIGEST,
    sourceInputsDigest: DIGEST,
    contractHash: "contract-abc",
    pinterestTagId: "pin-1",
    redditPixelId: "reddit-1",
  };
  const digest = computeReleaseInputDigest(base);
  // Deterministic for identical inputs.
  expect(computeReleaseInputDigest(base)).toBe(digest);
  // A different commit must produce a different identity, even when every other
  // input is unchanged — the site bytes bake in the commit, so the archive must
  // not collide across commits.
  expect(
    computeReleaseInputDigest({
      ...base,
      sourceCommit: "fedcba9876543210fedcba9876543210fedcba98",
    }),
  ).not.toBe(digest);
  // A different displayed version must also produce a different identity —
  // VITE_APP_VERSION / PUBLIC_APP_VERSION are baked into the site bytes.
  expect(computeReleaseInputDigest({ ...base, version: "2.0.0-100" })).not.toBe(
    digest,
  );
  // A non-commit input change still changes the identity.
  expect(
    computeReleaseInputDigest({ ...base, backendImageDigest: `${DIGEST}0` }),
  ).not.toBe(digest);
});

test("Scout release analytics map both hosts to the shared PostHog project", () => {
  expect(selectPostHogSite(POSTHOG_REGISTRY, "prod")).toEqual({
    projectToken: "phc_test",
    apiHost: "https://us.i.posthog.com",
    assetHost: "https://us-assets.i.posthog.com",
    proxyHost: "https://j.sjer.red",
    key: "scout-prod",
    domain: "scout-for-lol.com",
    sessionReplay: true,
    marketing: {
      pinterestTagId: "pin-1",
      redditPixelId: "reddit-1",
    },
  });
  expect(selectPostHogSite(POSTHOG_REGISTRY, "beta")).toEqual({
    projectToken: "phc_test",
    apiHost: "https://us.i.posthog.com",
    assetHost: "https://us-assets.i.posthog.com",
    proxyHost: "https://j.sjer.red",
    key: "scout-beta",
    domain: "beta.scout-for-lol.com",
    sessionReplay: true,
    marketing: undefined,
  });
});

test("beta release does not manufacture ad-pixel identifiers", async () => {
  const source = await Bun.file(
    new URL("scout-site-release.ts", import.meta.url),
  ).text();
  expect(source).not.toContain("beta-placeholder-pinterest-tag-id");
  expect(source).not.toContain("beta-placeholder-reddit-pixel-id");
  expect(source).toContain(
    'unsetEnv: flavor === "beta" ? [...MARKETING_ENV_NAMES] : [],',
  );
});

test("release state output creates its parent directory", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "scout-release-state-"));
  try {
    const output = path.join(dir, ".scout-release", "state.json");
    const state = parseScoutReleaseState(stateJson());
    await writeScoutReleaseState(output, state);
    expect(await Bun.file(output).json()).toEqual(state);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Scout CI publishes exact archives without legacy activation or registry retagging", async () => {
  const steps = await readGeneratedSteps(
    new URL("../..", import.meta.url).pathname,
  );
  const producer = findGeneratedStep(steps, "scout-site-archives");
  expect(producer).toBeDefined();
  const commands = (producer?.commands ?? []).join("\n");
  expect(commands).toContain("delivery-image-digests");
  expect(commands).toContain("ci-changed.ts site-scout");
  expect(commands).toContain("resolve-scout-delivery-backend.ts");
  expect(commands).toContain("publish-scout-site-archives.ts");
  expect(commands).not.toMatch(
    /deploy-beta|reconcile-prod|tag-release|imagetools/u,
  );
});
