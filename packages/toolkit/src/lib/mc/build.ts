import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  appendOp,
  BUILD_FILES,
  type Op,
} from "@shepherdjerred/mc-harness/protocol/build.ts";
import { BUILD_ENTRY } from "@shepherdjerred/mc-harness/protocol/paths.ts";
import { repoRoot } from "#lib/deployed/git.ts";

/**
 * Runs the mc-harness build CLI from the monorepo checkout. Compile, render
 * and lint need the registry, renderer and compile child, which stay out of
 * the compiled toolkit binary.
 */
export async function runBuildCli(args: string[]): Promise<number> {
  const root = await repoRoot();
  if (root === null) {
    throw new Error("toolkit mc build must run inside the monorepo checkout.");
  }
  const bun = Bun.which("bun");
  if (bun === null) {
    throw new Error("bun is required on PATH for toolkit mc build.");
  }
  const child = spawn(bun, ["run", path.join(root, BUILD_ENTRY), ...args], {
    stdio: "inherit",
  });
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => {
      resolve(code ?? 1);
    });
  });
}

/** Appends a successful op to a build directory's op log; prints where. */
export async function recordOp(dir: string, op: Op): Promise<void> {
  const count = await appendOp(path.resolve(dir), op);
  console.error(
    `recorded op #${count.toString()} in ${path.join(dir, BUILD_FILES.oplog)}`,
  );
}

/** Copies a schematic into the build's schematics/ dir (content-addressed). */
export async function storeSchematic(
  dir: string,
  file: string,
): Promise<string> {
  const bytes = new Uint8Array(await Bun.file(file).arrayBuffer());
  const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
  const relative = path.join(
    BUILD_FILES.schematicsDir,
    `manual-${digest}.schem`,
  );
  await mkdir(path.join(path.resolve(dir), BUILD_FILES.schematicsDir), {
    recursive: true,
  });
  await Bun.write(path.join(path.resolve(dir), relative), bytes);
  return relative;
}
