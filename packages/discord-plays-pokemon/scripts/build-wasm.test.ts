import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  applyPatch,
  buildWasm,
  fingerprintPatchedSource,
  fingerprintPatchSeries,
  newFilesInPatchSeries,
  patchSeriesIsComplete,
  resolveBuildWasmOptions,
  run,
  runRequired,
  type BuildWasmDependencies,
  type BuildWasmOptions,
} from "./build-wasm.ts";
import { parsePokemonUpstream } from "./lib/upstream.ts";
import { writeWasmArtifact } from "./lib/wasm-artifact.ts";

const UPSTREAM_COMMIT = "0123456789abcdef0123456789abcdef01234567";
const PREVIOUS_UPSTREAM_COMMIT = "1123456789abcdef0123456789abcdef01234567";
const WASM_HEADER = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00] as const;
const temporaryDirectories: string[] = [];

type BuildFixture = Readonly<{
  root: string;
  workDirectory: string;
  patchPath: string;
  options: BuildWasmOptions;
}>;

type FakeBuild = Readonly<{
  dependencies: BuildWasmDependencies;
  commands: string[][];
  patches: string[];
  logs: string[];
}>;

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { force: true, recursive: true });
  }
});

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

async function writeValidWasm(filePath: string): Promise<void> {
  const bytes = new Uint8Array(1024 * 1024);
  bytes.set(WASM_HEADER);
  await Bun.write(filePath, bytes, { createPath: true });
}

function bridgeMakefile(): string {
  return [
    "export=WasmReadObservation",
    "export=WasmReadMapTile",
    "export=WasmReadMapTopology",
    "export=WasmReadMapConnection",
    "export=WasmReadMapWarp",
    "export=WasmCanRunFromBattle",
    "export=WasmCanUseBattleItemOnBattler",
    "export=WasmCanUseBattleItemOnPartyMon",
    "export=WasmCheckpointSave",
  ].join("\n");
}

function bridgeSource(): string {
  return [
    "WasmReadObservation",
    "WasmReadMapTile",
    "WasmReadMapTopology",
    "WasmReadMapConnection",
    "WasmReadMapWarp",
    "WasmCanRunFromBattle",
    "WasmCanUseBattleItemOnBattler",
    "WasmCanUseBattleItemOnPartyMon",
    "WasmCheckpointSave",
    "}",
  ].join("\n");
}

async function createBuildFixture(): Promise<BuildFixture> {
  const fixtureRoot = await temporaryDirectory("pokemon-wasm-build-");
  const root = `${fixtureRoot}/package`;
  const workDirectory = `${fixtureRoot}/cache/pokeemerald`;
  const patchPath = `${root}/wasm-src/patches/0001-observation.patch`;
  await Bun.write(
    `${root}/wasm-src/upstream.json`,
    JSON.stringify({
      repository: "https://example.com/pokeemerald.git",
      branch: "master",
      commit: UPSTREAM_COMMIT,
    }),
    { createPath: true },
  );
  await Bun.write(
    patchPath,
    "--- /dev/null\n+++ b/src/wasm_observation.c\n@@ -0,0 +1 @@\n+}\n",
    { createPath: true },
  );
  return {
    root,
    workDirectory,
    patchPath,
    options: {
      root,
      workDirectory,
      buildEnvironment: {
        WASM_CC: "/toolchain/clang",
        WASM_LD: "/toolchain/wasm-ld",
      },
    },
  };
}

async function seedCheckout(
  fixture: BuildFixture,
  fingerprint?: string,
): Promise<void> {
  await mkdir(`${fixture.workDirectory}/data/maps`, { recursive: true });
  await Bun.write(`${fixture.workDirectory}/.git/HEAD`, "detached\n", {
    createPath: true,
  });
  await Bun.write(`${fixture.workDirectory}/Makefile`, bridgeMakefile());
  await Bun.write(
    `${fixture.workDirectory}/src/wasm_observation.c`,
    bridgeSource(),
    { createPath: true },
  );
  await Bun.write(
    `${fixture.workDirectory}/tools/mapjson/mapjson`,
    "fixture tool\n",
    { createPath: true },
  );
  if (fingerprint !== undefined) {
    await Bun.write(
      `${fixture.workDirectory}/.git/pokemon-wasm-patch-fingerprint`,
      `${fingerprint}\n`,
    );
  }
}

function createFakeBuild(
  fixture: BuildFixture,
  options: Readonly<{
    revisionExists?: boolean;
    completePatch?: boolean;
    validArtifact?: boolean;
    staleTrackedPatches?: boolean;
  }> = {},
): FakeBuild {
  const commands: string[][] = [];
  const patches: string[] = [];
  const logs: string[] = [];
  let staleTrackedPatches = options.staleTrackedPatches === true;
  const runCommand = async (command: readonly string[]): Promise<number> => {
    const captured = [...command];
    commands.push(captured);
    if (captured.includes("rev-parse")) {
      return options.revisionExists === true ? 0 : 1;
    }
    if (captured[0] === "git" && captured[1] === "clone") {
      await Bun.write(`${fixture.workDirectory}/.git/HEAD`, "detached\n", {
        createPath: true,
      });
    }
    if (captured.includes("reset")) {
      staleTrackedPatches = false;
    }
    if (staleTrackedPatches && captured.includes("checkout")) {
      return 1;
    }
    if (captured.includes("tools")) {
      await Bun.write(
        `${fixture.workDirectory}/tools/mapjson/mapjson`,
        "fixture tool\n",
        { createPath: true },
      );
    }
    if (captured.includes("wasm")) {
      const artifact = `${fixture.workDirectory}/build/wasm/pokeemerald.wasm`;
      if (options.validArtifact === false) {
        await Bun.write(artifact, new Uint8Array(1024 * 1024), {
          createPath: true,
        });
      } else {
        await writeValidWasm(artifact);
      }
    }
    return 0;
  };
  return {
    commands,
    patches,
    logs,
    dependencies: {
      runCommand,
      applySourcePatch: async (patchPath, workDirectory) => {
        patches.push(patchPath);
        await Bun.write(
          `${workDirectory}/Makefile`,
          options.completePatch === false ? "incomplete" : bridgeMakefile(),
        );
        if (options.completePatch !== false) {
          await Bun.write(
            `${workDirectory}/src/wasm_observation.c`,
            bridgeSource(),
            { createPath: true },
          );
        }
      },
      writeArtifact: writeWasmArtifact,
      log: (message) => {
        logs.push(message);
      },
    },
  };
}

function commandWasRun(commands: readonly string[][], value: string): boolean {
  return commands.some((command) =>
    command.some(
      (argument) => argument === value || argument.endsWith(`/${value}`),
    ),
  );
}

describe("upstream and toolchain validation", () => {
  test("requires an immutable upstream commit", () => {
    expect(() =>
      parsePokemonUpstream({
        repository: "https://example.com",
        branch: "main",
        commit: "main",
      }),
    ).toThrow("Invalid");
  });

  test("resolves explicit tools and default build paths", () => {
    const tools = new Map([
      ["wasm-ld", "/tools/wasm-ld"],
      ["clang", "/tools/clang"],
      ["uv", "/tools/uv"],
    ]);
    const options = resolveBuildWasmOptions(
      "/package",
      { TMPDIR: "/cache" },
      (tool) => tools.get(tool) ?? null,
    );

    expect(options).toEqual({
      root: "/package",
      workDirectory: "/cache/pokeemerald-wasm-build",
      buildEnvironment: {
        TMPDIR: "/cache",
        CPATH: "/opt/homebrew/include",
        LIBRARY_PATH: "/opt/homebrew/lib",
        WASM_CC: "/tools/clang",
        WASM_LD: "/tools/wasm-ld",
      },
    });
  });

  test("rejects missing LLVM and uv independently", () => {
    expect(() => resolveBuildWasmOptions("/package", {}, () => null)).toThrow(
      "Install LLVM",
    );
    expect(() =>
      resolveBuildWasmOptions(
        "/package",
        { WASM_CC: "/clang", WASM_LD: "/wasm-ld" },
        () => null,
      ),
    ).toThrow("uv is required");
  });
});

describe("command and patch execution", () => {
  test("returns subprocess status and reports required-command failures", async () => {
    expect(await run(["sh", "-c", "exit 0"])).toBe(0);
    await expect(
      runRequired(["fixture", "command"], undefined, async () => 7),
    ).rejects.toThrow("Command failed (7): fixture command");
  });

  test("applies a source patch and reports malformed patches", async () => {
    const directory = await temporaryDirectory("pokemon-patch-");
    await Bun.write(`${directory}/source.txt`, "before\n");
    const patchPath = `${directory}/change.patch`;
    await Bun.write(
      patchPath,
      "--- a/source.txt\n+++ b/source.txt\n@@ -1 +1 @@\n-before\n+after\n",
    );

    await applyPatch(patchPath, directory);
    expect(await Bun.file(`${directory}/source.txt`).text()).toBe("after\n");

    await Bun.write(patchPath, "not a patch\n");
    await expect(applyPatch(patchPath, directory)).rejects.toThrow(
      `Patch failed: ${patchPath}`,
    );
  });
});

describe("patch source identity and ABI validation", () => {
  test("fingerprints ordered patches and the upstream ABI identity", async () => {
    const directory = await temporaryDirectory("pokemon-wasm-patches-");
    const firstPatch = path.join(directory, "0001-first.patch");
    const secondPatch = path.join(directory, "0002-second.patch");
    await Promise.all([
      Bun.write(firstPatch, "first patch\n"),
      Bun.write(secondPatch, "second patch\n"),
    ]);

    const patchFingerprint = await fingerprintPatchSeries([
      secondPatch,
      firstPatch,
    ]);
    expect(await fingerprintPatchSeries([firstPatch, secondPatch])).toBe(
      patchFingerprint,
    );
    expect(
      fingerprintPatchedSource(UPSTREAM_COMMIT, patchFingerprint),
    ).not.toBe(
      fingerprintPatchedSource(
        "1123456789abcdef0123456789abcdef01234567",
        patchFingerprint,
      ),
    );
  });

  test("identifies new patch files and validates every bridge symbol", async () => {
    const patchPaths = [
      ...new Bun.Glob("*.patch").scanSync({
        cwd: `${import.meta.dir}/../wasm-src/patches`,
        absolute: true,
      }),
    ];

    expect(await newFilesInPatchSeries(patchPaths)).toEqual([
      "src/wasm_observation.c",
    ]);
    expect(patchSeriesIsComplete(bridgeMakefile(), bridgeSource())).toBe(true);
    expect(patchSeriesIsComplete("incomplete", bridgeSource())).toBe(false);
  });

  test("keeps the observation and trapping patches structurally complete", async () => {
    const observationPatch = await Bun.file(
      `${import.meta.dir}/../wasm-src/patches/0001-extra-exports.patch`,
    ).text();
    const eligibilityPatch = await Bun.file(
      `${import.meta.dir}/../wasm-src/patches/0004-battle-eligibility.patch`,
    ).text();

    expect(observationPatch).toContain("@@ -0,0 +1,595 @@");
    expect(observationPatch.trimEnd().endsWith("+}")).toBe(true);
    expect(observationPatch).toContain(
      "+    sWasmObservation.battleTypeFlags = gBattleTypeFlags;",
    );
    expect(eligibilityPatch).toContain(
      "+        if (GetBattlerSide(other) == GetBattlerSide(battler)\n" +
        "+         || (gAbsentBattlerFlags & (1u << other))\n" +
        "+         || gBattleMons[other].hp == 0)",
    );
    expect(eligibilityPatch).toContain(
      "+     || ((effect[0] & ITEM0_X_ATTACK)\n" +
        "+         && gBattleMons[battler].statStages[STAT_ATK] < MAX_STAT_STAGE)",
    );
    expect(eligibilityPatch).toContain(
      "+         & (STATUS2_ESCAPE_PREVENTION | STATUS2_WRAPPED))\n" +
        "+     || (gStatuses3[battler] & STATUS3_ROOTED)",
    );
    expect(eligibilityPatch).toContain(
      "+        if (gBattleMons[other].ability == ABILITY_SHADOW_TAG)",
    );
  });

  test("reads first-turn and later-turn moves from live battler state", async () => {
    const liveMovesPatch = await Bun.file(
      `${import.meta.dir}/../wasm-src/patches/0005-live-battle-moves.patch`,
    ).text();

    expect(liveMovesPatch).toContain(
      "+                u16 move = gBattleMons[battler].moves[moveSlot];",
    );
    expect(liveMovesPatch).toContain(
      "+                    gBattleMons[battler].pp[moveSlot];",
    );
    expect(liveMovesPatch).toContain(
      "+                        move, gBattleMons[battler].ppBonuses, moveSlot);",
    );
    expect(liveMovesPatch).not.toContain("+            moveInfo =");
    expect(liveMovesPatch).not.toContain("+                    gBattleBufferA");
  });
});

describe("WASM build orchestration", () => {
  test("clones, refreshes patches, builds maps and WASM, and regenerates data", async () => {
    const fixture = await createBuildFixture();
    const fake = createFakeBuild(fixture);
    await Bun.write(
      `${fixture.workDirectory}/src/wasm_observation.c`,
      "stale\n",
      { createPath: true },
    );
    await Bun.write(
      `${fixture.workDirectory}/data/maps/Littleroot/map.json`,
      "{}\n",
      { createPath: true },
    );

    await buildWasm(fixture.options, fake.dependencies);

    expect(fake.patches).toEqual([fixture.patchPath]);
    expect(commandWasRun(fake.commands, "clone")).toBe(true);
    expect(commandWasRun(fake.commands, "fetch")).toBe(true);
    expect(commandWasRun(fake.commands, "reset")).toBe(true);
    expect(commandWasRun(fake.commands, "tools")).toBe(true);
    expect(commandWasRun(fake.commands, "groups")).toBe(true);
    expect(commandWasRun(fake.commands, "layouts")).toBe(true);
    expect(commandWasRun(fake.commands, "map")).toBe(true);
    expect(commandWasRun(fake.commands, "generate-battle-data.ts")).toBe(true);
    expect(
      Bun.file(`${fixture.root}/packages/backend/assets/pokeemerald.wasm`).size,
    ).toBe(1024 * 1024);
    expect(fake.logs).toHaveLength(1);
  });

  test("reuses a complete checkout only for the exact source fingerprint", async () => {
    const fixture = await createBuildFixture();
    const patchFingerprint = await fingerprintPatchSeries([fixture.patchPath]);
    const sourceFingerprint = fingerprintPatchedSource(
      UPSTREAM_COMMIT,
      patchFingerprint,
    );
    await seedCheckout(fixture, sourceFingerprint);
    const fake = createFakeBuild(fixture, { revisionExists: true });

    await buildWasm(fixture.options, fake.dependencies);

    expect(fake.patches).toEqual([]);
    expect(commandWasRun(fake.commands, "fetch")).toBe(false);
    expect(commandWasRun(fake.commands, "reset")).toBe(false);
    expect(commandWasRun(fake.commands, "tools")).toBe(false);
  });

  test("resets stale patches before checking out and applying a new upstream pin", async () => {
    const fixture = await createBuildFixture();
    const previousPatchFingerprint = await fingerprintPatchSeries([
      fixture.patchPath,
    ]);
    await seedCheckout(
      fixture,
      fingerprintPatchedSource(
        PREVIOUS_UPSTREAM_COMMIT,
        previousPatchFingerprint,
      ),
    );
    await Bun.write(
      fixture.patchPath,
      "--- /dev/null\n+++ b/src/wasm_observation.c\n@@ -0,0 +1 @@\n+/* current patch set */}\n",
    );
    const currentPatchFingerprint = await fingerprintPatchSeries([
      fixture.patchPath,
    ]);
    const fake = createFakeBuild(fixture, {
      revisionExists: true,
      staleTrackedPatches: true,
    });

    await buildWasm(fixture.options, fake.dependencies);

    const resetIndex = fake.commands.findIndex((command) =>
      command.includes("reset"),
    );
    const checkoutIndex = fake.commands.findIndex((command) =>
      command.includes("checkout"),
    );
    expect(resetIndex).toBeGreaterThanOrEqual(0);
    expect(checkoutIndex).toBeGreaterThan(resetIndex);
    expect(fake.commands[resetIndex]).toEqual([
      "git",
      "-C",
      fixture.workDirectory,
      "reset",
      "--hard",
    ]);
    expect(fake.commands[checkoutIndex]).toEqual([
      "git",
      "-C",
      fixture.workDirectory,
      "checkout",
      "--detach",
      UPSTREAM_COMMIT,
    ]);
    expect(fake.patches).toEqual([fixture.patchPath]);
    expect(
      await Bun.file(
        `${fixture.workDirectory}/.git/pokemon-wasm-patch-fingerprint`,
      ).text(),
    ).toBe(
      `${fingerprintPatchedSource(UPSTREAM_COMMIT, currentPatchFingerprint)}\n`,
    );
  });

  test("rejects an incomplete refreshed ABI before blessing the cache", async () => {
    const fixture = await createBuildFixture();
    await seedCheckout(fixture, "stale-fingerprint");
    const fake = createFakeBuild(fixture, {
      revisionExists: true,
      completePatch: false,
    });

    await expect(buildWasm(fixture.options, fake.dependencies)).rejects.toThrow(
      "has an incomplete patch series",
    );
    expect(
      await Bun.file(
        `${fixture.workDirectory}/.git/pokemon-wasm-patch-fingerprint`,
      ).text(),
    ).toBe("stale-fingerprint\n");
    expect(commandWasRun(fake.commands, "wasm")).toBe(false);
  });

  test("rejects an invalid compiled artifact before running generators", async () => {
    const fixture = await createBuildFixture();
    await seedCheckout(fixture);
    const fake = createFakeBuild(fixture, {
      revisionExists: true,
      validArtifact: false,
    });

    await expect(buildWasm(fixture.options, fake.dependencies)).rejects.toThrow(
      "invalid header",
    );
    expect(commandWasRun(fake.commands, "generate-species-data.ts")).toBe(
      false,
    );
  });
});

describe("WASM artifact publication", () => {
  test("creates the ignored asset directory for a validated artifact", async () => {
    const directory = await temporaryDirectory("pokemon-wasm-artifact-");
    const source = `${directory}/pokeemerald.wasm`;
    const output = `${directory}/packages/backend/assets/pokeemerald.wasm`;
    await writeValidWasm(source);

    await writeWasmArtifact(source, output);

    expect(Bun.file(output).size).toBe(1024 * 1024);
  });

  test("rejects missing, truncated, and invalid-header artifacts", async () => {
    const directory = await temporaryDirectory("pokemon-wasm-invalid-");
    const output = `${directory}/output.wasm`;
    await expect(
      writeWasmArtifact(`${directory}/missing.wasm`, output),
    ).rejects.toThrow("did not produce an artifact");
    await Bun.write(`${directory}/small.wasm`, new Uint8Array(WASM_HEADER));
    await expect(
      writeWasmArtifact(`${directory}/small.wasm`, output),
    ).rejects.toThrow("unexpectedly small");
    await Bun.write(`${directory}/invalid.wasm`, new Uint8Array(1024 * 1024));
    await expect(
      writeWasmArtifact(`${directory}/invalid.wasm`, output),
    ).rejects.toThrow("invalid header");
  });
});
