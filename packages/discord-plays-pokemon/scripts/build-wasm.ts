import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { parsePokemonUpstream } from "./lib/upstream.ts";
import { writeWasmArtifact } from "./lib/wasm-artifact.ts";

async function run(
  command: string[],
  environment: Record<string, string | undefined> = Bun.env,
): Promise<number> {
  const subprocess = Bun.spawn(command, {
    env: environment,
    stdout: "inherit",
    stderr: "inherit",
  });
  return await subprocess.exited;
}

async function runRequired(
  command: string[],
  environment?: Record<string, string | undefined>,
): Promise<void> {
  const exitCode = await run(command, environment);
  if (exitCode !== 0) {
    throw new Error(
      `Command failed (${exitCode.toString()}): ${command.join(" ")}`,
    );
  }
}

async function applyPatch(
  patchPath: string,
  workingDirectory: string,
): Promise<void> {
  const process = Bun.spawn(
    ["patch", "-p1", "--no-backup-if-mismatch", "-d", workingDirectory],
    { stdin: Bun.file(patchPath), stdout: "inherit", stderr: "inherit" },
  );
  if ((await process.exited) !== 0)
    throw new Error(`Patch failed: ${patchPath}`);
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

if (import.meta.main) {
  const root = import.meta.dir.replace(/\/scripts$/, "");
  const upstream = parsePokemonUpstream(
    await Bun.file(`${root}/wasm-src/upstream.json`).json(),
  );
  const workDirectory =
    Bun.env["WORKDIR"] ??
    `${Bun.env["TMPDIR"] ?? "/tmp"}/pokeemerald-wasm-build`;
  const compiler =
    Bun.env["WASM_CC"] ??
    Bun.which("/opt/homebrew/opt/llvm/bin/clang") ??
    Bun.which("/usr/local/opt/llvm/bin/clang") ??
    Bun.which("clang");
  const linker =
    Bun.env["WASM_LD"] ??
    Bun.which("wasm-ld") ??
    Bun.which("/opt/homebrew/opt/llvm/bin/wasm-ld");
  if (compiler === null || linker === null) {
    throw new Error("Install LLVM with wasm32 clang and wasm-ld");
  }
  if (Bun.which("uv") === null) throw new Error("uv is required");
  const buildEnvironment = {
    ...Bun.env,
    CPATH: Bun.env["CPATH"] ?? "/opt/homebrew/include",
    LIBRARY_PATH: Bun.env["LIBRARY_PATH"] ?? "/opt/homebrew/lib",
    WASM_CC: compiler,
    WASM_LD: linker,
  };
  if (!(await Bun.file(`${workDirectory}/.git/HEAD`).exists())) {
    await mkdir(path.dirname(workDirectory), { recursive: true });
    await runRequired([
      "git",
      "clone",
      "--no-checkout",
      upstream.repository,
      workDirectory,
    ]);
  }
  const revisionExitCode = await run([
    "git",
    "-C",
    workDirectory,
    "rev-parse",
    "--verify",
    "--quiet",
    `${upstream.commit}^{commit}`,
  ]);
  if (revisionExitCode !== 0) {
    await runRequired([
      "git",
      "-C",
      workDirectory,
      "fetch",
      "--depth=1",
      "origin",
      upstream.commit,
    ]);
  }
  await runRequired([
    "git",
    "-C",
    workDirectory,
    "checkout",
    "--detach",
    upstream.commit,
  ]);
  const patchPaths = [
    ...new Bun.Glob("*.patch").scanSync({
      cwd: `${root}/wasm-src/patches`,
      absolute: true,
    }),
  ].sort();
  const patchFingerprint = await fingerprintPatchSeries(patchPaths);
  const fingerprintPath = `${workDirectory}/.git/pokemon-wasm-patch-fingerprint`;
  const fingerprintFile = Bun.file(fingerprintPath);
  const cachedFingerprintText = (await fingerprintFile.exists())
    ? await fingerprintFile.text()
    : null;
  const cachedFingerprint = cachedFingerprintText?.trim() ?? null;
  const patchSeriesRefreshed = cachedFingerprint !== patchFingerprint;
  if (patchSeriesRefreshed) {
    await runRequired([
      "git",
      "-C",
      workDirectory,
      "reset",
      "--hard",
      upstream.commit,
    ]);
    for (const file of await newFilesInPatchSeries(patchPaths)) {
      await rm(path.join(workDirectory, file), {
        force: true,
        recursive: true,
      });
    }
    for (const patchPath of patchPaths) {
      await applyPatch(patchPath, workDirectory);
    }
  }
  const makefile = await Bun.file(`${workDirectory}/Makefile`).text();
  const observationSource = Bun.file(`${workDirectory}/src/wasm_observation.c`);
  const observationSourceText = (await observationSource.exists())
    ? await observationSource.text()
    : "";
  const requiredBridgeSymbols = [
    "WasmReadObservation",
    "WasmReadMapTile",
    "WasmReadMapTopology",
    "WasmReadMapConnection",
    "WasmReadMapWarp",
    "WasmCheckpointSave",
  ];
  const patchSeriesComplete =
    requiredBridgeSymbols.every((symbol) =>
      makefile.includes(`export=${symbol}`),
    ) &&
    requiredBridgeSymbols.every((symbol) =>
      observationSourceText.includes(symbol),
    ) &&
    observationSourceText.trimEnd().endsWith("}");
  if (!patchSeriesComplete) {
    throw new Error(
      `Cached wasm source at ${workDirectory} has an incomplete patch series; use a fresh WORKDIR`,
    );
  }
  if (patchSeriesRefreshed) {
    await Bun.write(fingerprintPath, `${patchFingerprint}\n`);
  }
  if (!(await Bun.file(`${workDirectory}/tools/mapjson/mapjson`).exists())) {
    await runRequired(["make", "-C", workDirectory, "tools"], buildEnvironment);
  }
  const mapjson = `${workDirectory}/tools/mapjson/mapjson`;
  await runRequired([
    mapjson,
    "groups",
    "emerald",
    `${workDirectory}/data/maps/map_groups.json`,
    `${workDirectory}/data/maps`,
    `${workDirectory}/include`,
  ]);
  await runRequired([
    mapjson,
    "layouts",
    "emerald",
    `${workDirectory}/data/layouts/layouts.json`,
    `${workDirectory}/data/layouts`,
    `${workDirectory}/include`,
  ]);
  for (const map of new Bun.Glob("*/map.json").scanSync({
    cwd: `${workDirectory}/data/maps`,
  })) {
    const directory = `${workDirectory}/data/maps/${map.replace(/\/map\.json$/, "")}`;
    await runRequired([
      mapjson,
      "map",
      "emerald",
      `${directory}/map.json`,
      `${workDirectory}/data/layouts/layouts.json`,
      directory,
    ]);
  }
  await runRequired(["make", "-C", workDirectory, "wasm"], buildEnvironment);
  const output = `${root}/packages/backend/assets/pokeemerald.wasm`;
  await writeWasmArtifact(
    `${workDirectory}/build/wasm/pokeemerald.wasm`,
    output,
  );
  console.log(
    `[build-wasm] wrote ${output} (${Bun.file(output).size.toString()} bytes)`,
  );
  await runRequired(["bun", `${root}/scripts/generate-species-data.ts`]);
  await runRequired(["bun", `${root}/scripts/generate-map-names.ts`]);
  await runRequired(["bun", `${root}/scripts/generate-battle-data.ts`]);
}
