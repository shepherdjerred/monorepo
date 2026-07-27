import { $ } from "bun";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseN64Upstream } from "./upstream.ts";

async function applyPatch(
  patch: string,
  cwd: string,
  dryRun = false,
): Promise<void> {
  const arguments_ = ["patch", "-p1"];
  if (dryRun) arguments_.push("--dry-run", "--force");
  else arguments_.push("--no-backup-if-mismatch");
  const process = Bun.spawn(arguments_, {
    cwd,
    stdin: Bun.file(patch),
    stdout: "inherit",
    stderr: "inherit",
  });
  if ((await process.exited) !== 0) throw new Error(`Patch failed: ${patch}`);
}

export { applyPatch };

if (import.meta.main) {
  const root = import.meta.dir.replace(/\/scripts$/, "");
  const upstream = parseN64Upstream(
    await Bun.file(`${root}/wasm-src/upstream.json`).json(),
  );
  const build = await mkdtemp(path.join(tmpdir(), "n64wasm-build-"));
  try {
    await cp(`${root}/wasm-src/code`, `${build}/code`, { recursive: true });
    for (const patch of new Bun.Glob("*.patch").scanSync({
      cwd: `${root}/wasm-src/patches`,
      absolute: true,
    })) {
      await applyPatch(patch, build);
    }
    await $`docker run --rm -v ${`${build}:/src`} -w /src/code ${upstream.emsdkImage} bash -c make`;
    const output = `${root}/packages/backend/assets/n64wasm`;
    await mkdir(`${output}/res`, { recursive: true });
    for (const name of [
      "n64wasm.js",
      "n64wasm.wasm",
      "shader_vert.hlsl",
      "shader_frag.hlsl",
      "overlay.png",
    ]) {
      await Bun.write(`${output}/${name}`, Bun.file(`${build}/code/${name}`));
    }
    await Bun.write(
      `${output}/res/arial.ttf`,
      Bun.file(`${build}/code/res/arial.ttf`),
    );
  } finally {
    await rm(build, { force: true, recursive: true });
  }
}
