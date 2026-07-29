import { mkdir } from "node:fs/promises";
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
  const makefile = await Bun.file(`${workDirectory}/Makefile`).text();
  const hasExtraExports = makefile.includes("export=gSaveBlock2Ptr");
  const observationSource = Bun.file(`${workDirectory}/src/wasm_observation.c`);
  const observationSourceText = (await observationSource.exists())
    ? await observationSource.text()
    : "";
  const hasObservationBridge =
    observationSourceText.includes("WasmReadObservation") &&
    observationSourceText.includes("WasmReadMapTile") &&
    observationSourceText.trimEnd().endsWith("}");
  const hasCheckpointExport = makefile.includes("export=WasmCheckpointSave");
  const hasCheckpointBridge =
    observationSourceText.includes("WasmCheckpointSave");
  if (
    hasExtraExports !== hasObservationBridge ||
    hasCheckpointExport !== hasCheckpointBridge ||
    hasExtraExports !== hasCheckpointExport
  ) {
    throw new Error(
      `Cached wasm source at ${workDirectory} has an incomplete patch series; use a fresh WORKDIR`,
    );
  }
  if (!hasExtraExports) {
    for (const patch of new Bun.Glob("*.patch").scanSync({
      cwd: `${root}/wasm-src/patches`,
      absolute: true,
    })) {
      await applyPatch(patch, workDirectory);
    }
  }
  if (!(await Bun.file(`${workDirectory}/tools/mapjson/mapjson`).exists())) {
    await runRequired(["make", "-C", workDirectory, "tools"]);
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
  await runRequired(["make", "-C", workDirectory, "wasm"], {
    ...Bun.env,
    CPATH: Bun.env["CPATH"] ?? "/opt/homebrew/include",
    LIBRARY_PATH: Bun.env["LIBRARY_PATH"] ?? "/opt/homebrew/lib",
    WASM_CC: compiler,
    WASM_LD: linker,
  });
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
