// Builds the native SpaghettiKart port with this repo's patch series and
// extracts its ROM-derived asset archive, for the local latency spike.
//
//   bun run build:spaghetti [--rom <path>]
//
// Everything lands in the gitignored .cache/spaghetti/: the pinned upstream
// checkout (src/), its CMake build (src/build-cmake/), the ROM-derived
// mk64.o2r (assets/), and dist/manifest.json, which the backend harness reads.
// mk64.o2r is generated from the ROM, so like the ROM it must never be
// committed, logged, or copied into an image.
import { $ } from "bun";
import { cp, mkdir, rm, symlink } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { applyPatch } from "./build-wasm.ts";
import {
  assertSupportedRom,
  cmakeConfigureArgs,
  parseSpaghettiUpstream,
  romCandidates,
  sha1,
  spaghettiBinaryPath,
} from "./spaghetti.ts";

const root = path.resolve(import.meta.dir, "..");
const cache = path.join(root, ".cache/spaghetti");
const sourceDir = path.join(cache, "src");
const buildDir = path.join(sourceDir, "build-cmake");
const assetsDir = path.join(cache, "assets");
const distDir = path.join(cache, "dist");

const { values } = parseArgs({ options: { rom: { type: "string" } } });
const upstream = parseSpaghettiUpstream(
  await Bun.file(path.join(root, "spaghetti-src/upstream.json")).json(),
);

async function resolveRom(): Promise<string> {
  const candidates = romCandidates(values.rom, Bun.env["MK64_ROM"]);
  for (const candidate of candidates) {
    if (await Bun.file(candidate).exists()) return candidate;
  }
  throw new Error(
    `MK64 ROM not found; pass --rom, set MK64_ROM, or use the Syncthing path. Tried: ${candidates.join(", ")}`,
  );
}

async function checkout(): Promise<void> {
  if (!(await Bun.file(path.join(sourceDir, ".git/HEAD")).exists())) {
    await mkdir(cache, { recursive: true });
    await $`git clone --filter=blob:none --no-checkout ${upstream.repository} ${sourceDir}`;
  }
  await $`git -C ${sourceDir} fetch --quiet --filter=blob:none origin ${upstream.commit}`;
  // Reset the tree (keeping the incremental CMake build) so patches apply to pristine upstream.
  await $`git -C ${sourceDir} checkout --quiet --force --detach ${upstream.commit}`;
  await $`git -C ${sourceDir} clean -fdq -e build-cmake`;
  await $`git -C ${sourceDir} submodule update --init --force --depth 50 ${upstream.submodules}`;
  for (const submodule of upstream.submodules) {
    await $`git -C ${path.join(sourceDir, submodule)} clean -fdq`;
  }
  const patches = [
    ...new Bun.Glob("*.patch").scanSync({
      cwd: path.join(root, "spaghetti-src/patches"),
      absolute: true,
    }),
  ].sort();
  for (const patch of patches) await applyPatch(patch, sourceDir);
}

async function build(): Promise<void> {
  const configure = cmakeConfigureArgs(sourceDir, buildDir, process.platform);
  await $`${configure}`;
  await $`cmake --build ${buildDir}`;
  // The engine archive is only a side effect of macOS bundling; build it explicitly.
  await $`cmake --build ${buildDir} --target GenerateO2R`;
}

/** Extracts mk64.o2r with the build's Torch, unless this ROM + Torch already produced it. */
async function extractAssets(): Promise<string> {
  const rom = await resolveRom();
  const romSha1 = sha1(await Bun.file(rom).bytes());
  assertSupportedRom(romSha1, upstream.romSha1);

  const output = path.join(assetsDir, "mk64.o2r");
  const stamp = path.join(assetsDir, "stamp.json");
  const wanted = JSON.stringify({ romSha1, commit: upstream.commit });
  if (
    (await Bun.file(output).exists()) &&
    (await Bun.file(stamp).exists()) &&
    (await Bun.file(stamp).text()) === wanted
  ) {
    return output;
  }

  // Torch reads config.yml, yamls/, include/defines.h and meta/ relative to its
  // working directory and writes mk64.o2r there; give it a private one.
  const work = path.join(cache, "assets-work");
  await rm(work, { recursive: true, force: true });
  await mkdir(path.join(work, "include"), { recursive: true });
  await mkdir(path.join(work, "meta"), { recursive: true });
  await cp(path.join(sourceDir, "config.yml"), path.join(work, "config.yml"));
  await cp(path.join(sourceDir, "yamls"), path.join(work, "yamls"), {
    recursive: true,
  });
  await cp(
    path.join(sourceDir, "include/defines.h"),
    path.join(work, "include/defines.h"),
  );
  await cp(
    path.join(sourceDir, "meta/mods.toml"),
    path.join(work, "meta/mods.toml"),
  );
  await symlink(rom, path.join(work, "baserom.us.z64"));
  const torch = path.join(
    buildDir,
    "TorchExternal/src/TorchExternal-build/torch",
  );
  await $`${torch} o2r baserom.us.z64 --additional-files meta/mods.toml`
    .cwd(work)
    .quiet();

  await mkdir(assetsDir, { recursive: true });
  await cp(path.join(work, "mk64.o2r"), output);
  await Bun.write(stamp, wanted);
  await rm(work, { recursive: true, force: true });
  return output;
}

await checkout();
await build();
const gameArchive = await extractAssets();
const manifest = {
  binary: spaghettiBinaryPath(buildDir, process.platform),
  engineArchive: path.join(buildDir, "spaghetti.o2r"),
  gameArchive,
};
for (const file of Object.values(manifest)) {
  if (!(await Bun.file(file).exists()))
    throw new Error(`build output missing: ${file}`);
}
await mkdir(distDir, { recursive: true });
await Bun.write(
  path.join(distDir, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
console.log(
  `SpaghettiKart ${upstream.commit.slice(0, 10)} ready: ${path.join(distDir, "manifest.json")}`,
);
