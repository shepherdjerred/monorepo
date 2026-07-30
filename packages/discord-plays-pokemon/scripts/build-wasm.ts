import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { parsePokemonUpstream } from "./lib/upstream.ts";
import { writeWasmArtifact } from "./lib/wasm-artifact.ts";

type Environment = Record<string, string | undefined>;
type CommandRunner = (
  command: readonly string[],
  environment?: Environment,
) => Promise<number>;

export type BuildWasmOptions = Readonly<{
  root: string;
  workDirectory: string;
  buildEnvironment: Environment;
}>;

export type BuildWasmDependencies = Readonly<{
  runCommand: CommandRunner;
  applySourcePatch: (patchPath: string, workDirectory: string) => Promise<void>;
  writeArtifact: (source: string, output: string) => Promise<void>;
  log: (message: string) => void;
}>;

const REQUIRED_BRIDGE_SYMBOLS = [
  "WasmReadObservation",
  "WasmReadMapTile",
  "WasmReadMapTopology",
  "WasmReadMapConnection",
  "WasmReadMapWarp",
  "WasmCanUseBattleItemOnPartyMon",
  "WasmCheckpointSave",
] as const;

export async function run(
  command: readonly string[],
  environment: Environment = Bun.env,
): Promise<number> {
  const subprocess = Bun.spawn([...command], {
    env: environment,
    stdout: "inherit",
    stderr: "inherit",
  });
  return await subprocess.exited;
}

export async function runRequired(
  command: readonly string[],
  environment: Environment | undefined,
  runCommand: CommandRunner,
): Promise<void> {
  const exitCode = await runCommand(command, environment);
  if (exitCode !== 0) {
    throw new Error(
      `Command failed (${exitCode.toString()}): ${command.join(" ")}`,
    );
  }
}

export async function applyPatch(
  patchPath: string,
  workingDirectory: string,
): Promise<void> {
  const process = Bun.spawn(
    ["patch", "-p1", "--no-backup-if-mismatch", "-d", workingDirectory],
    { stdin: Bun.file(patchPath), stdout: "inherit", stderr: "inherit" },
  );
  if ((await process.exited) !== 0) {
    throw new Error(`Patch failed: ${patchPath}`);
  }
}

export async function fingerprintPatchSeries(
  patchPaths: readonly string[],
): Promise<string> {
  const patches = await Promise.all(
    [...patchPaths].sort().map(async (patchPath) => ({
      name: path.basename(patchPath),
      contents: await Bun.file(patchPath).text(),
    })),
  );
  const hasher = new Bun.CryptoHasher("sha256");
  for (const patch of patches) {
    hasher.update(patch.name);
    hasher.update("\0");
    hasher.update(patch.contents);
    hasher.update("\0");
  }
  return hasher.digest("hex");
}

export function fingerprintPatchedSource(
  upstreamCommit: string,
  patchFingerprint: string,
): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(upstreamCommit);
  hasher.update("\0");
  hasher.update(patchFingerprint);
  hasher.update("\0");
  for (const symbol of REQUIRED_BRIDGE_SYMBOLS) {
    hasher.update(symbol);
    hasher.update("\0");
  }
  return hasher.digest("hex");
}

export async function newFilesInPatchSeries(
  patchPaths: readonly string[],
): Promise<string[]> {
  const patchTexts = await Promise.all(
    patchPaths.map(async (patchPath) => await Bun.file(patchPath).text()),
  );
  const newFiles = new Set<string>();
  for (const patchText of patchTexts) {
    for (const match of patchText.matchAll(
      /^--- \/dev\/null\n\+\+\+ b\/(.+)$/gm,
    )) {
      const file = match[1];
      if (file === undefined) {
        throw new Error("new-file patch header is missing its target path");
      }
      newFiles.add(file);
    }
  }
  return [...newFiles].sort();
}

export function patchSeriesIsComplete(
  makefile: string,
  observationSource: string,
): boolean {
  return (
    REQUIRED_BRIDGE_SYMBOLS.every((symbol) =>
      makefile.includes(`export=${symbol}`),
    ) &&
    REQUIRED_BRIDGE_SYMBOLS.every((symbol) =>
      observationSource.includes(symbol),
    ) &&
    observationSource.trimEnd().endsWith("}")
  );
}

export function resolveBuildWasmOptions(
  root: string,
  environment: Environment,
  which: (tool: string) => string | null,
): BuildWasmOptions {
  const workDirectory =
    environment["WORKDIR"] ??
    `${environment["TMPDIR"] ?? "/tmp"}/pokeemerald-wasm-build`;
  const compiler =
    environment["WASM_CC"] ??
    which("/opt/homebrew/opt/llvm/bin/clang") ??
    which("/usr/local/opt/llvm/bin/clang") ??
    which("clang");
  const linker =
    environment["WASM_LD"] ??
    which("wasm-ld") ??
    which("/opt/homebrew/opt/llvm/bin/wasm-ld");
  if (compiler === null || linker === null) {
    throw new Error("Install LLVM with wasm32 clang and wasm-ld");
  }
  if (which("uv") === null) {
    throw new Error("uv is required");
  }
  return {
    root,
    workDirectory,
    buildEnvironment: {
      ...environment,
      CPATH: environment["CPATH"] ?? "/opt/homebrew/include",
      LIBRARY_PATH: environment["LIBRARY_PATH"] ?? "/opt/homebrew/lib",
      WASM_CC: compiler,
      WASM_LD: linker,
    },
  };
}

async function ensureRepository(
  repository: string,
  workDirectory: string,
  runCommand: CommandRunner,
): Promise<void> {
  if (await Bun.file(`${workDirectory}/.git/HEAD`).exists()) {
    return;
  }
  await mkdir(path.dirname(workDirectory), { recursive: true });
  await runRequired(
    ["git", "clone", "--no-checkout", repository, workDirectory],
    undefined,
    runCommand,
  );
}

async function checkoutRevision(
  commit: string,
  workDirectory: string,
  runCommand: CommandRunner,
): Promise<void> {
  const revisionExitCode = await runCommand([
    "git",
    "-C",
    workDirectory,
    "rev-parse",
    "--verify",
    "--quiet",
    `${commit}^{commit}`,
  ]);
  if (revisionExitCode !== 0) {
    await runRequired(
      ["git", "-C", workDirectory, "fetch", "--depth=1", "origin", commit],
      undefined,
      runCommand,
    );
  }
  await runRequired(
    ["git", "-C", workDirectory, "checkout", "--detach", commit],
    undefined,
    runCommand,
  );
}

async function refreshPatchSeries(
  commit: string,
  workDirectory: string,
  patchPaths: readonly string[],
  dependencies: BuildWasmDependencies,
): Promise<void> {
  await runRequired(
    ["git", "-C", workDirectory, "reset", "--hard", commit],
    undefined,
    dependencies.runCommand,
  );
  for (const file of await newFilesInPatchSeries(patchPaths)) {
    await rm(path.join(workDirectory, file), {
      force: true,
      recursive: true,
    });
  }
  for (const patchPath of patchPaths) {
    await dependencies.applySourcePatch(patchPath, workDirectory);
  }
}

async function readCachedFingerprint(
  fingerprintPath: string,
): Promise<string | null> {
  const fingerprintFile = Bun.file(fingerprintPath);
  if (!(await fingerprintFile.exists())) {
    return null;
  }
  const fingerprint = await fingerprintFile.text();
  return fingerprint.trim();
}

async function validatePatchedSource(workDirectory: string): Promise<void> {
  const makefile = await Bun.file(`${workDirectory}/Makefile`).text();
  const observationSource = Bun.file(`${workDirectory}/src/wasm_observation.c`);
  const observationSourceText = (await observationSource.exists())
    ? await observationSource.text()
    : "";
  if (!patchSeriesIsComplete(makefile, observationSourceText)) {
    throw new Error(
      `Cached wasm source at ${workDirectory} has an incomplete patch series; use a fresh WORKDIR`,
    );
  }
}

async function generateMapAssets(
  workDirectory: string,
  buildEnvironment: Environment,
  runCommand: CommandRunner,
): Promise<void> {
  const mapjson = `${workDirectory}/tools/mapjson/mapjson`;
  if (!(await Bun.file(mapjson).exists())) {
    await runRequired(
      ["make", "-C", workDirectory, "tools"],
      buildEnvironment,
      runCommand,
    );
  }
  await runRequired(
    [
      mapjson,
      "groups",
      "emerald",
      `${workDirectory}/data/maps/map_groups.json`,
      `${workDirectory}/data/maps`,
      `${workDirectory}/include`,
    ],
    undefined,
    runCommand,
  );
  await runRequired(
    [
      mapjson,
      "layouts",
      "emerald",
      `${workDirectory}/data/layouts/layouts.json`,
      `${workDirectory}/data/layouts`,
      `${workDirectory}/include`,
    ],
    undefined,
    runCommand,
  );
  for (const map of new Bun.Glob("*/map.json").scanSync({
    cwd: `${workDirectory}/data/maps`,
  })) {
    const directory = `${workDirectory}/data/maps/${map.replace(/\/map\.json$/, "")}`;
    await runRequired(
      [
        mapjson,
        "map",
        "emerald",
        `${directory}/map.json`,
        `${workDirectory}/data/layouts/layouts.json`,
        directory,
      ],
      undefined,
      runCommand,
    );
  }
}

async function generateTypeScriptData(
  root: string,
  runCommand: CommandRunner,
): Promise<void> {
  for (const script of [
    "generate-species-data.ts",
    "generate-map-names.ts",
    "generate-battle-data.ts",
  ]) {
    await runRequired(
      ["bun", `${root}/scripts/${script}`],
      undefined,
      runCommand,
    );
  }
}

const defaultDependencies: BuildWasmDependencies = {
  runCommand: run,
  applySourcePatch: applyPatch,
  writeArtifact: writeWasmArtifact,
  log: console.log,
};

export async function buildWasm(
  options: BuildWasmOptions,
  dependencies: BuildWasmDependencies = defaultDependencies,
): Promise<void> {
  const { root, workDirectory, buildEnvironment } = options;
  const upstream = parsePokemonUpstream(
    await Bun.file(`${root}/wasm-src/upstream.json`).json(),
  );
  await ensureRepository(
    upstream.repository,
    workDirectory,
    dependencies.runCommand,
  );
  await checkoutRevision(
    upstream.commit,
    workDirectory,
    dependencies.runCommand,
  );

  const patchPaths = [
    ...new Bun.Glob("*.patch").scanSync({
      cwd: `${root}/wasm-src/patches`,
      absolute: true,
    }),
  ].sort();
  const patchFingerprint = await fingerprintPatchSeries(patchPaths);
  const sourceFingerprint = fingerprintPatchedSource(
    upstream.commit,
    patchFingerprint,
  );
  const fingerprintPath = `${workDirectory}/.git/pokemon-wasm-patch-fingerprint`;
  const cachedFingerprint = await readCachedFingerprint(fingerprintPath);
  const patchSeriesRefreshed = cachedFingerprint !== sourceFingerprint;
  if (patchSeriesRefreshed) {
    await refreshPatchSeries(
      upstream.commit,
      workDirectory,
      patchPaths,
      dependencies,
    );
  }
  await validatePatchedSource(workDirectory);
  if (patchSeriesRefreshed) {
    await Bun.write(fingerprintPath, `${sourceFingerprint}\n`);
  }

  await generateMapAssets(
    workDirectory,
    buildEnvironment,
    dependencies.runCommand,
  );
  await runRequired(
    ["make", "-C", workDirectory, "wasm"],
    buildEnvironment,
    dependencies.runCommand,
  );
  const output = `${root}/packages/backend/assets/pokeemerald.wasm`;
  await dependencies.writeArtifact(
    `${workDirectory}/build/wasm/pokeemerald.wasm`,
    output,
  );
  dependencies.log(
    `[build-wasm] wrote ${output} (${Bun.file(output).size.toString()} bytes)`,
  );
  await generateTypeScriptData(root, dependencies.runCommand);
}

if (import.meta.main) {
  const root = import.meta.dir.replace(/\/scripts$/, "");
  await buildWasm(resolveBuildWasmOptions(root, Bun.env, Bun.which));
}
