import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  legacyBuildNumberFromSubject,
  pushWithExactLease,
  resetVersionBumpBranch,
} from "./update-versions.ts";
import {
  mergePinCandidates,
  mergePinStates,
  parsePinCandidates,
  parsePinCandidatesState,
  parseVersionsSource,
  reconstructLegacyPinState,
  rewriteVersionsSource,
  serializePinCandidatesState,
  validateStateAgainstVersions,
} from "./lib/pin-candidates.ts";

const A =
  "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const B =
  "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const KEY = "shepherdjerred/example";

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

async function git(repo: string, args: string[]): Promise<string> {
  const proc = Bun.spawn(["git", "-C", repo, ...args], {
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

  test.each([
    '{"schema":"pin-candidates/v1","buildNumber":0,"candidates":{}}',
    '{"schema":"pin-candidates/v1","buildNumber":1,"candidates":{},"extra":1}',
    `{"schema":"pin-candidates/v1","buildNumber":1,"candidates":{"x":{"version":"","digest":"${A}"}}}`,
    '{"schema":"pin-candidates/v1","buildNumber":1,"candidates":{"x":{"version":"v1","digest":"SHA256:AA"}}}',
    `{"schema":"pin-candidates/v1","buildNumber":1,"candidates":{"x":{"version":"v1","digest":"${A}","extra":1}}}`,
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
    expect(Object.keys(mergePinStates(left, right).pins).sort()).toEqual([
      "left",
      "right",
    ]);
  });
});

describe("versions.ts integrity", () => {
  const source = `export const versions = {
  "${KEY}": "old@${A}",
  "chart": "1.0.0",
} as const;\n`;

  test("rewrites exact managed keys and serializes canonically", () => {
    const state = mergePinCandidates(
      parsePinCandidatesState('{"schema":"pin-candidates-state/v1","pins":{}}'),
      batch(12, "v12", B),
    );
    const rewritten = rewriteVersionsSource(source, state);
    expect(rewritten).toContain(`"${KEY}": "v12@${B}"`);
    validateStateAgainstVersions(state, parseVersionsSource(rewritten));
    expect(serializePinCandidatesState(state)).toEndWith("\n");
  });

  test("fails closed when state and versions drift", () => {
    const state = mergePinCandidates(
      parsePinCandidatesState('{"schema":"pin-candidates-state/v1","pins":{}}'),
      batch(12, "v12", B),
    );
    expect(() =>
      validateStateAgainstVersions(state, parseVersionsSource(source)),
    ).toThrow("pin state drift");
  });

  test("rejects duplicate source keys", () => {
    expect(() =>
      parseVersionsSource(`{"${KEY}":"v@${A}","${KEY}":"v@${A}"}`),
    ).toThrow("duplicate");
  });

  test("reconstructs only image changes from a legacy generated branch", () => {
    const base = parseVersionsSource(`{
      "${KEY}": "v1@${A}",
      "unchanged": "v1@${A}",
    }`);
    const pending = parseVersionsSource(`{
      "${KEY}": "v2@${B}",
      "unchanged": "v1@${A}",
    }`);

    expect(reconstructLegacyPinState(base, pending, 42).pins).toEqual({
      [KEY]: { buildNumber: 42, version: "v2", digest: B },
    });
  });

  test("rejects non-image changes in a legacy generated branch", () => {
    const base = parseVersionsSource('{"chart":"1.0.0"}');
    const pending = parseVersionsSource('{"chart":"2.0.0"}');

    expect(() => reconstructLegacyPinState(base, pending, 42)).toThrow(
      "legacy bump changed non-image version chart",
    );
  });
});

describe("legacy generated branch metadata", () => {
  test.each([
    "chore: update image pins from build 6922\n",
    "chore: bump image versions to 2.0.0-6922",
  ])("parses the generated commit subject: %s", (subject) => {
    expect(legacyBuildNumberFromSubject(subject)).toBe(6922);
  });

  test("rejects an ambiguous commit subject", () => {
    expect(() => legacyBuildNumberFromSubject("chore: update images")).toThrow(
      "unexpected subject",
    );
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
