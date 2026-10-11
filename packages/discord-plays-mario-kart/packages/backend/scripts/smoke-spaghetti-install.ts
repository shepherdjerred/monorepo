#!/usr/bin/env bun
// ROM-free check of the image's SpaghettiKart install: install.json is valid,
// every file it names exists, and on Linux the game and Torch find all of their
// shared libraries. Running the game needs the ROM-derived archive, so this is
// the deepest check an image smoke can make without the ROM.
//
//   bun run smoke:spaghetti-install [install_dir]
import { loadSpaghettiInstall } from "#src/engine/spaghetti/install.ts";

const installDir =
  Bun.argv[2] ?? Bun.env["SPAGHETTI_INSTALL_DIR"] ?? "assets/spaghettikart";
const install = await loadSpaghettiInstall(installDir);

async function assertLibrariesResolve(binary: string): Promise<void> {
  const proc = Bun.spawn(["ldd", binary], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    throw new Error(`ldd ${binary} failed (${String(code)}): ${stderr}`);
  }
  const missing = stdout
    .split("\n")
    .filter((line) => line.includes("not found"))
    .map((line) => line.trim());
  if (missing.length > 0) {
    throw new Error(
      `${binary} is missing shared libraries:\n${missing.join("\n")}`,
    );
  }
}

if (process.platform === "linux") {
  await assertLibrariesResolve(install.binary);
  await assertLibrariesResolve(install.torch);
}
process.stdout.write(
  `SpaghettiKart install OK: ${install.commit.slice(0, 10)} at ${installDir}\n`,
);
