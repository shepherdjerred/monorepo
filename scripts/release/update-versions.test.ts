import { describe, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { hermeticGitEnv } from "../lib/test-git.ts";

import {
  pushWithExactLease,
  resetVersionBumpBranch,
} from "./update-versions.ts";
import {
  findSupersededPendingPinKeys,
  mergePinCandidates,
  mergePinStates,
  mergeVersionCatalogSources,
  parseVersionCatalogSource,
  retainCurrentImagePins,
  rewriteVersionCatalogSource,
  serializePinCandidatesState,
} from "../lib/pin-candidates.ts";
import {
  parsePinCandidates,
  parsePinCandidatesState,
  validateStateAgainstVersions,
} from "../lib/pin-candidates-schema.ts";

const A =
  "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const B =
  "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const KEY = "shepherdjerred/example";
const GIT_SHA_A = "a".repeat(40);
const GIT_SHA_B = "b".repeat(40);

function catalogSource(
  entries: { name: string; value: string; notes?: string[] }[],
): string {
  return JSON.stringify({
    $schema: "./schema.json",
    schemaVersion: 1,
    entries: entries.map((entry) => ({
      name: entry.name,
      category: entry.name.startsWith("shepherdjerred/")
        ? "internal-image"
        : "upstream",
      artifactType: entry.value.includes("@sha256:") ? "image" : "source",
      management: entry.name.startsWith("shepherdjerred/")
        ? { managed: true, datasource: "docker", versioning: "docker" }
        : { managed: false },
      value: entry.value,
      ...(entry.notes === undefined ? {} : { notes: entry.notes }),
    })),
  });
}

function batch(
  buildNumber: number,
  version: string,
  digest: string,
  key = KEY,
) {
  return parsePinCandidates(
    JSON.stringify({
      schema: "pin-candidates/v1",
      buildNumber,
      candidates: { [key]: { version, digest } },
    }),
  );
}

function batchWithGitSha(gitSha: string) {
  return parsePinCandidates(
    JSON.stringify({
      schema: "pin-candidates/v1",
      buildNumber: 10,
      candidates: { [KEY]: { version: "v10", digest: A, gitSha } },
    }),
  );
}

async function git(repo: string, args: string[]): Promise<string> {
  const proc = Bun.spawn(["git", "-C", repo, ...args], {
    // Isolated from the operator's ~/.gitconfig — see hermeticGitEnv.
    env: hermeticGitEnv(repo),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed (${exitCode.toString()}): ${stderr}`,
    );
  }
  return stdout.trim();
}

test("reconstructs a stale conflicting bump branch from current main", async () => {
  const repo = await mkdtemp(path.join(tmpdir(), "version-bump-branch-"));
  const versionsFile = path.join(repo, "versions.ts");

  try {
    await git(repo, ["init", "-b", "main"]);
    await git(repo, ["config", "user.email", "ci@sjer.red"]);
    await git(repo, ["config", "user.name", "CI Bot"]);
    await Bun.write(versionsFile, 'export const image = "base";\n');
    await git(repo, ["add", "versions.ts"]);
    await git(repo, ["commit", "-m", "base"]);

    await git(repo, ["checkout", "-b", "chore/version-bump-pending"]);
    await Bun.write(versionsFile, 'export const image = "stale-bump";\n');
    await git(repo, ["add", "versions.ts"]);
    await git(repo, ["commit", "-m", "stale bump"]);

    await git(repo, ["checkout", "main"]);
    await Bun.write(versionsFile, 'export const image = "current-main";\n');
    await git(repo, ["add", "versions.ts"]);
    await git(repo, ["commit", "-m", "advance main"]);
    await git(repo, [
      "update-ref",
      "refs/remotes/origin/main",
      await git(repo, ["rev-parse", "main"]),
    ]);
    await git(repo, ["checkout", "chore/version-bump-pending"]);

    await resetVersionBumpBranch((args) => git(repo, args));

    expect(await git(repo, ["branch", "--show-current"])).toBe(
      "chore/version-bump-pending",
    );
    expect(await git(repo, ["rev-parse", "HEAD"])).toBe(
      await git(repo, ["rev-parse", "origin/main"]),
    );
    expect(await Bun.file(versionsFile).text()).toBe(
      'export const image = "current-main";\n',
    );
    expect(await git(repo, ["status", "--porcelain"])).toBe("");
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
}, 20_000);

describe("pin candidate schema", () => {
  test("accepts an empty candidate set", () => {
    expect(
      parsePinCandidates(
        '{"schema":"pin-candidates/v1","buildNumber":1,"candidates":{}}',
      ).candidates,
    ).toEqual({});
  });

  test("preserves the baked routing commit through candidate state", () => {
    const gitSha = "f".repeat(40);
    const candidate = parsePinCandidates(
      JSON.stringify({
        schema: "pin-candidates/v1",
        buildNumber: 42,
        candidates: {
          [KEY]: { version: "v42", digest: A, gitSha },
        },
      }),
    );
    const state = mergePinCandidates(
      { schema: "pin-candidates-state/v1", pins: {} },
      candidate,
    );
    expect(state.pins[KEY]).toEqual({
      buildNumber: 42,
      version: "v42",
      digest: A,
      gitSha,
    });
  });

  test.each([
    '{"schema":"pin-candidates/v1","buildNumber":0,"candidates":{}}',
    '{"schema":"pin-candidates/v1","buildNumber":1,"candidates":{},"extra":1}',
    `{"schema":"pin-candidates/v1","buildNumber":1,"candidates":{"x":{"version":"","digest":"${A}"}}}`,
    '{"schema":"pin-candidates/v1","buildNumber":1,"candidates":{"x":{"version":"v1","digest":"SHA256:AA"}}}',
    `{"schema":"pin-candidates/v1","buildNumber":1,"candidates":{"x":{"version":"v1","digest":"${A}","extra":1}}}`,
    `{"schema":"pin-candidates/v1","buildNumber":1,"candidates":{"x":{"version":"v1","digest":"${A}","gitSha":"short"}}}`,
  ])("rejects malformed input: %s", (input) => {
    expect(() => parsePinCandidates(input)).toThrow();
  });

  test("rejects malformed persisted state", () => {
    expect(() =>
      parsePinCandidatesState(
        `{"schema":"pin-candidates-state/v1","pins":{"x":{"buildNumber":1,"version":"v1","digest":"${A}","extra":true}}}`,
      ),
    ).toThrow();
  });
});

describe("key-wise monotonic arbitration", () => {
  const empty = parsePinCandidatesState(
    '{"schema":"pin-candidates-state/v1","pins":{}}',
  );

  test("higher build wins and lower build is ignored", () => {
    const initial = mergePinCandidates(empty, batch(10, "v10", A));
    expect(mergePinCandidates(initial, batch(9, "v9", B))).toEqual(initial);
    expect(mergePinCandidates(initial, batch(11, "v11", B)).pins[KEY]).toEqual({
      buildNumber: 11,
      version: "v11",
      digest: B,
    });
  });

  test("equal build and identical content is idempotent", () => {
    const initial = mergePinCandidates(empty, batch(10, "v10", A));
    expect(mergePinCandidates(initial, batch(10, "v10", A))).toEqual(initial);
  });

  test("equal build preserves a known image commit from either candidate", () => {
    const legacy = mergePinCandidates(empty, batch(10, "v10", A));
    const known = mergePinCandidates(empty, batchWithGitSha(GIT_SHA_A));

    expect(mergePinCandidates(legacy, batchWithGitSha(GIT_SHA_A))).toEqual(
      known,
    );
    expect(mergePinCandidates(known, batch(10, "v10", A))).toEqual(known);
    expect(() => mergePinCandidates(known, batchWithGitSha(GIT_SHA_B))).toThrow(
      "conflicting candidates",
    );
  });

  test("equal build preserves a known image commit across state merges", () => {
    const legacy = mergePinCandidates(empty, batch(10, "v10", A));
    const known = mergePinCandidates(empty, batchWithGitSha(GIT_SHA_A));
    const conflicting = mergePinCandidates(empty, batchWithGitSha(GIT_SHA_B));

    expect(mergePinStates(legacy, known, empty)).toEqual(known);
    expect(mergePinStates(known, legacy, empty)).toEqual(known);
    expect(() => mergePinStates(known, conflicting, empty)).toThrow(
      "conflicting candidates",
    );
  });

  test.each([
    ["v10-conflict", A],
    ["v10", B],
  ])("equal build conflicts on version or digest", (version, digest) => {
    const initial = mergePinCandidates(empty, batch(10, "v10", A));
    expect(() =>
      mergePinCandidates(initial, batch(10, version, digest)),
    ).toThrow("conflicting candidates");
  });

  test("merges pending keys independently", () => {
    const left = mergePinCandidates(empty, batch(10, "v10", A, "left"));
    const right = mergePinCandidates(empty, batch(11, "v11", B, "right"));
    expect(Object.keys(mergePinStates(left, right, empty).pins).sort()).toEqual(
      ["left", "right"],
    );
  });

  test("does not restore a stale pending pin deleted from main", () => {
    const oldPin = mergePinCandidates(empty, batch(17_396, "v17396", A));
    expect(mergePinStates(empty, oldPin, oldPin)).toEqual(empty);
  });

  test("preserves a pending pin added after the merge base", () => {
    const pending = mergePinCandidates(empty, batch(18_031, "v18031", B));
    expect(mergePinStates(empty, pending, empty)).toEqual(pending);
  });

  test("does not restore a squash-merged pin that main later reset", () => {
    const base = mergePinCandidates(empty, batch(17_395, "v17395", A));
    const pending = mergePinCandidates(base, batch(17_396, "v17396", B));
    const main = base;
    const superseded = findSupersededPendingPinKeys(main, pending, base, [
      pending,
    ]);

    expect(superseded).toEqual(new Set([KEY]));
    expect(mergePinStates(main, pending, base, superseded)).toEqual(main);
  });

  test("keeps the newer pin when main and pending both advance a key", () => {
    const base = mergePinCandidates(empty, batch(10, "v10", A));
    const main = mergePinCandidates(base, batch(11, "v11", B));
    const pending = mergePinCandidates(base, batch(12, "v12", A));
    expect(mergePinStates(main, pending, base)).toEqual(pending);
  });

  test("drops retired pins from an older pending branch", () => {
    const pending = mergePinCandidates(
      mergePinCandidates(empty, batch(12, "v12", B)),
      batch(11, "v11", A, "shepherdjerred/retired"),
    );
    const { state, retiredKeys } = retainCurrentImagePins(
      pending,
      new Map([[KEY, `v12@${B}`]]),
    );

    expect(Object.keys(state.pins)).toEqual([KEY]);
    expect(state.pins[KEY]).toEqual({
      buildNumber: 12,
      version: "v12",
      digest: B,
    });
    expect(retiredKeys).toEqual(["shepherdjerred/retired"]);
  });
});

describe("version catalog integrity", () => {
  const source = catalogSource([
    { name: KEY, value: `old@${A}` },
    { name: "chart", value: "1.0.0" },
  ]);

  test("rewrites exact managed keys as Prettier-stable canonical JSON", async () => {
    const state = mergePinCandidates(
      parsePinCandidatesState('{"schema":"pin-candidates-state/v1","pins":{}}'),
      batch(12, "v12", B),
    );
    const rewritten = await rewriteVersionCatalogSource(
      catalogSource([
        { name: KEY, value: `old@${A}`, notes: ["not managed"] },
        { name: "chart", value: "1.0.0" },
      ]),
      state,
    );
    expect(rewritten).toContain(`"value": "v12@${B}"`);
    expect(rewritten).toContain('"notes": ["not managed"]');
    const entryStart = rewritten.indexOf(`"name": "${KEY}"`);
    const management = rewritten.indexOf('"management":', entryStart);
    const value = rewritten.indexOf(`"value": "v12@${B}"`, entryStart);
    expect(entryStart).toBeGreaterThanOrEqual(0);
    expect(management).toBeGreaterThan(entryStart);
    expect(value).toBeGreaterThan(management);
    validateStateAgainstVersions(state, parseVersionCatalogSource(rewritten));
    expect(serializePinCandidatesState(state).endsWith("\n")).toBe(true);
  });

  test("merges pending catalog changes without restoring main retirements", async () => {
    const mainOnly = "shepherdjerred/main-only";
    const pendingOnly = "shepherdjerred/pending-only";
    const retiredOnMain = "shepherdjerred/retired-on-main";
    const retiredOnPending = "shepherdjerred/retired-on-pending";
    const baseSource = catalogSource([
      { name: KEY, value: `base@${A}` },
      { name: mainOnly, value: `base@${A}` },
      { name: retiredOnMain, value: `base@${A}` },
      { name: retiredOnPending, value: `base@${A}` },
    ]);
    const mainSource = catalogSource([
      { name: KEY, value: `main@${A}` },
      { name: mainOnly, value: `main@${B}` },
      { name: retiredOnPending, value: `base@${A}` },
    ]);
    const pendingSource = catalogSource([
      { name: KEY, value: `pending@${B}` },
      { name: mainOnly, value: `base@${A}` },
      { name: retiredOnMain, value: `base@${A}` },
      { name: pendingOnly, value: `pending@${B}` },
    ]);

    const mergedSource = mergeVersionCatalogSources(
      mainSource,
      pendingSource,
      baseSource,
    );
    const mergedVersions = parseVersionCatalogSource(mergedSource);

    expect(mergedVersions.get(KEY)).toBe(`main@${A}`);
    expect(mergedVersions.get(mainOnly)).toBe(`main@${B}`);
    expect(mergedVersions.get(pendingOnly)).toBe(`pending@${B}`);
    expect(mergedVersions.has(retiredOnMain)).toBe(false);
    expect(mergedVersions.has(retiredOnPending)).toBe(false);

    const state = mergePinCandidates(
      parsePinCandidatesState('{"schema":"pin-candidates-state/v1","pins":{}}'),
      batch(18_031, "v18031", B, pendingOnly),
    );
    const rewrittenSource = await rewriteVersionCatalogSource(
      mergedSource,
      state,
    );
    validateStateAgainstVersions(
      state,
      parseVersionCatalogSource(rewrittenSource),
    );
    expect(rewrittenSource).toContain(`"name": "${pendingOnly}"`);
    expect(rewrittenSource).toContain(`"value": "v18031@${B}"`);
  });

  test("does not restore a squash-merged catalog pin that main later reset", () => {
    const baseSource = catalogSource([{ name: KEY, value: `v17395@${A}` }]);
    const mainSource = catalogSource([{ name: KEY, value: `v17395@${A}` }]);
    const pendingSource = catalogSource([{ name: KEY, value: `v17396@${B}` }]);

    const merged = mergeVersionCatalogSources(
      mainSource,
      pendingSource,
      baseSource,
      new Set([KEY]),
    );

    expect(parseVersionCatalogSource(merged).get(KEY)).toBe(`v17395@${A}`);
  });

  test("leaves Scout beta notes untouched when rewriting the pin", async () => {
    const state = mergePinCandidates(
      parsePinCandidatesState('{"schema":"pin-candidates-state/v1","pins":{}}'),
      batch(12, "v12", B, "shepherdjerred/scout-for-lol/beta"),
    );
    const rewritten = await rewriteVersionCatalogSource(
      catalogSource([
        {
          name: "shepherdjerred/scout-for-lol/beta",
          value: `old@${A}`,
          notes: ["not managed"],
        },
      ]),
      state,
    );
    expect(rewritten).toContain(`"value": "v12@${B}"`);
    expect(rewritten).toContain('"notes": ["not managed"]');
  });

  test("fails closed when state and versions drift", () => {
    const state = mergePinCandidates(
      parsePinCandidatesState('{"schema":"pin-candidates-state/v1","pins":{}}'),
      batch(12, "v12", B),
    );
    expect(() =>
      validateStateAgainstVersions(state, parseVersionCatalogSource(source)),
    ).toThrow("pin state drift");
  });

  test("keeps the committed candidate state aligned with the committed catalog", async () => {
    const [stateSource, catalogSourceText] = await Promise.all([
      Bun.file(new URL("../pin-candidates-state.json", import.meta.url)).text(),
      Bun.file(
        new URL(
          "../../packages/version-catalog/src/catalog.json",
          import.meta.url,
        ),
      ).text(),
    ]);

    expect(() =>
      validateStateAgainstVersions(
        parsePinCandidatesState(stateSource),
        parseVersionCatalogSource(catalogSourceText),
      ),
    ).not.toThrow();
  });

  test("rejects duplicate source keys", () => {
    expect(() =>
      parseVersionCatalogSource(
        catalogSource([
          { name: KEY, value: `v@${A}` },
          { name: KEY, value: `v@${A}` },
        ]),
      ),
    ).toThrow("unique");
  });
});

describe("exact lease", () => {
  test("includes the expected remote sha", async () => {
    const calls: string[][] = [];
    const result = await pushWithExactLease(async (args) => {
      calls.push(args);
      return { exitCode: 0, stderr: "", stdout: "" };
    }, "1234567890123456789012345678901234567890");
    expect(result).toBe("pushed");
    expect(calls[0]).toContain(
      "--force-with-lease=refs/heads/chore/version-bump-pending:1234567890123456789012345678901234567890",
    );
  });

  test("retries only lease-like rejection", async () => {
    expect(
      await pushWithExactLease(
        async () => ({
          exitCode: 1,
          stderr: "rejected (stale info)",
          stdout: "",
        }),
        null,
      ),
    ).toBe("retry");
    await expect(
      pushWithExactLease(
        async () => ({
          exitCode: 1,
          stderr: "authentication failed",
          stdout: "",
        }),
        null,
      ),
    ).rejects.toThrow("authentication failed");
  });
});
