import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  computeReleaseInputDigest,
  hashReleaseInputFiles,
  writeScoutReleaseState,
} from "./scout-site-release.ts";
import {
  parseLegacyScoutReleaseManifest,
  parseScoutReleaseState,
  retagScoutReleaseState,
  resolveBackendDigest,
  resolveProdPin,
  siteReleaseIdentity,
  validateProdPinState,
} from "./lib/scout-release-state.ts";
import { hashSiteArchive } from "./lib/scout-site-storage.ts";

const DIGEST =
  "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

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

test("strict Scout release state binds version to build number", () => {
  const state = parseScoutReleaseState(stateJson());
  expect(siteReleaseIdentity(state)).toBe(`scout-site@${DIGEST}`);
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
  const source = `export default {"shepherdjerred/scout-for-lol/beta":"2.0.0-1@${DIGEST}"};`;
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

test("production pin resolution returns only the exact canonical pin", () => {
  const source = `export default {"shepherdjerred/scout-for-lol/prod":"2.0.0-42@${DIGEST}"};`;
  expect(resolveProdPin(source)).toBe(`2.0.0-42@${DIGEST}`);
  expect(() =>
    resolveProdPin(
      'export default {"shepherdjerred/scout-for-lol/prod":"latest"};',
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

test("release input digest binds to the source commit", () => {
  const base = {
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
  // A non-commit input change still changes the identity.
  expect(
    computeReleaseInputDigest({ ...base, backendImageDigest: `${DIGEST}0` }),
  ).not.toBe(digest);
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

test("pipeline selects Scout for a source change or exact beta candidate", async () => {
  const pipeline = await Bun.file(
    new URL("../.buildkite/pipeline.yml", import.meta.url),
  ).text();
  const betaStart = pipeline.indexOf("key: scout-beta-release");
  const tagStart = pipeline.indexOf("key: scout-tag-release");
  const beta = pipeline.slice(betaStart, tagStart);
  expect(beta).toContain('."shepherdjerred/scout-for-lol/beta" // empty');
  expect(beta).toContain("ci-changed.ts site-scout");
  expect(beta).toContain(
    'if [ -z "$$scout_candidate" ] && ! $$scout_source_changed; then exit 0; fi',
  );
  expect(beta).not.toContain("cancel_on_build_failing");
  const prodStart = pipeline.indexOf("key: scout-prod-reconcile");
  const prodEnd = pipeline.indexOf(
    'label: ":terraform: tofu apply (cloudflare',
    prodStart,
  );
  expect(pipeline.slice(tagStart, prodEnd)).not.toContain(
    "cancel_on_build_failing",
  );
  expect(pipeline.slice(prodStart, prodEnd)).toContain(
    'reconcile-prod-pin --prod-pin "$$prod_pin"',
  );
});

test("production pin dry runs return before remote release lookup", async () => {
  const source = await Bun.file(
    new URL("scout-site-release.ts", import.meta.url),
  ).text();
  const reconcileStart = source.indexOf("async function reconcileProdPin");
  const usageStart = source.indexOf("function usage", reconcileStart);
  const reconcile = source.slice(reconcileStart, usageStart);
  const dryRun = reconcile.indexOf("if (dryRun)");
  const remoteLookup = reconcile.indexOf("await readScoutStateByVersion");
  expect(dryRun).toBeGreaterThan(0);
  expect(remoteLookup).toBeGreaterThan(dryRun);
});

test("tag creation verifies both immutable archive byte sets first", async () => {
  const source = await Bun.file(
    new URL("scout-site-release.ts", import.meta.url),
  ).text();
  const tagStart = source.indexOf("async function tagRelease");
  const usageStart = source.indexOf("function usage", tagStart);
  const tag = source.slice(tagStart, usageStart);
  const prod = tag.indexOf('await assertScoutArchiveBytes(state, "prod")');
  const beta = tag.indexOf('await assertScoutArchiveBytes(state, "beta")');
  const publish = tag.indexOf('"imagetools"');
  expect(prod).toBeGreaterThan(0);
  expect(beta).toBeGreaterThan(prod);
  expect(publish).toBeGreaterThan(beta);
});
