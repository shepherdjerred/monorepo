// Builds the native SpaghettiKart port with this repo's patch series, for
// running the backend or its harnesses against a local build.
//
//   bun run build:spaghetti
//
// Everything lands in the gitignored .cache/spaghetti/: the pinned upstream
// checkout (src/), its CMake build (src/build-cmake/), and dist/install.json,
// the install the backend loads (point [spaghettikart] install_dir at
// .cache/spaghetti/dist). No ROM is needed here: the backend extracts the
// ROM-derived mk64.o2r itself at startup. The image builds the same inputs in
// the Dockerfile's spaghetti-builder stage.
import { $ } from "bun";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  applyPatch,
  cmakeConfigureArgs,
  devInstallManifest,
  parseSpaghettiUpstream,
} from "./spaghetti.ts";

const root = path.resolve(import.meta.dir, "..");
const cache = path.join(root, ".cache/spaghetti");
const sourceDir = path.join(cache, "src");
const buildDir = path.join(sourceDir, "build-cmake");
const distDir = path.join(cache, "dist");

const upstream = parseSpaghettiUpstream(
  await Bun.file(path.join(root, "spaghetti-src/upstream.json")).json(),
);

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

await checkout();
await build();
const manifest = devInstallManifest(
  upstream,
  sourceDir,
  buildDir,
  process.platform,
);
for (const file of [
  manifest.binary,
  manifest.engineArchive,
  manifest.torch,
  manifest.labelFont,
]) {
  if (!(await Bun.file(file).exists()))
    throw new Error(`build output missing: ${file}`);
}
await mkdir(distDir, { recursive: true });
await Bun.write(
  path.join(distDir, "install.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
console.log(
  `SpaghettiKart ${upstream.commit.slice(0, 10)} ready: ${path.join(distDir, "install.json")}`,
);
