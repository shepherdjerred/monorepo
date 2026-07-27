import { cp, lstat, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { applyPatch } from "./build-wasm.ts";
import { parseN64Upstream, parseVendorExcludes } from "./upstream.ts";

async function run(command: string[]): Promise<number> {
  const subprocess = Bun.spawn(command, {
    stdout: "inherit",
    stderr: "inherit",
  });
  return await subprocess.exited;
}

async function runRequired(command: string[]): Promise<void> {
  const exitCode = await run(command);
  if (exitCode !== 0) {
    throw new Error(
      `Command failed (${exitCode.toString()}): ${command.join(" ")}`,
    );
  }
}

if (import.meta.main) {
  const root = import.meta.dir.replace(/\/scripts$/, "");
  const wasmSource = `${root}/wasm-src`;
  const upstream = parseN64Upstream(
    await Bun.file(`${wasmSource}/upstream.json`).json(),
  );
  const temporary = await mkdtemp(path.join(tmpdir(), "n64wasm-vendor-"));
  const clone = `${temporary}/upstream`;
  try {
    await runRequired(["git", "init", "--quiet", clone]);
    await runRequired([
      "git",
      "-C",
      clone,
      "remote",
      "add",
      "origin",
      upstream.repository,
    ]);
    let fetched = false;
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const exitCode = await run([
        "git",
        "-C",
        clone,
        "-c",
        "http.postBuffer=524_288_000",
        "fetch",
        "--quiet",
        "--depth",
        "1",
        "origin",
        upstream.commit,
      ]);
      if (exitCode === 0) {
        fetched = true;
        break;
      }
      if (attempt < 4) await Bun.sleep(3000);
    }
    if (!fetched) throw new Error("N64Wasm fetch failed after four attempts");
    await runRequired([
      "git",
      "-C",
      clone,
      "checkout",
      "--quiet",
      "FETCH_HEAD",
    ]);
    const excludes = parseVendorExcludes(
      await Bun.file(`${wasmSource}/vendor-excludes.txt`).text(),
    );
    for (const excludePath of excludes) {
      const target = `${clone}/${excludePath}`;
      const targetExists = await lstat(target)
        .then(() => true)
        .catch(() => false);
      if (!targetExists) {
        throw new Error(`Exclude path not found upstream: ${excludePath}`);
      }
      await rm(target, { force: true, recursive: true });
    }
    await rm(`${wasmSource}/code`, { force: true, recursive: true });
    await cp(`${clone}/code`, `${wasmSource}/code`, { recursive: true });
    for (const patch of new Bun.Glob("*.patch").scanSync({
      cwd: `${wasmSource}/patches`,
      absolute: true,
    })) {
      await applyPatch(patch, wasmSource, true);
    }
    console.log(
      `[vendor] pristine at ${upstream.commit} minus declared excludes; patches verified`,
    );
  } finally {
    await rm(temporary, { force: true, recursive: true });
  }
}
