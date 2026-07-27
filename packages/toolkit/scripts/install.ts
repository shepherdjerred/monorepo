import { chmod, mkdir, rm } from "node:fs/promises";
import { installPaths } from "./install-core.ts";

async function run(command: string[], cwd: string): Promise<void> {
  const subprocess = Bun.spawn(command, {
    cwd,
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await subprocess.exited;
  if (exitCode !== 0) {
    throw new Error(
      `Command failed (${exitCode.toString()}): ${command.join(" ")}`,
    );
  }
}

if (import.meta.main) {
  const home = Bun.env["HOME"];
  if (home === undefined) throw new Error("HOME is required");
  const root = import.meta.dir.replace(/\/scripts$/, "");
  const paths = installPaths(home);
  await run(
    [
      "bun",
      "build",
      "./src/index.ts",
      "--compile",
      "--external",
      "ffmpeg-static",
      "--outfile=dist/toolkit",
    ],
    root,
  );
  await Promise.all([
    mkdir(`${home}/.local/bin`, { recursive: true }),
    mkdir(`${home}/.claude/skills/pr-health`, { recursive: true }),
  ]);
  await rm(paths.binary, { force: true });
  await Bun.write(paths.binary, Bun.file(`${root}/dist/toolkit`));
  await chmod(paths.binary, 0o755);
  if (process.platform === "darwin") {
    await run(["codesign", "--force", "--sign", "-", paths.binary], root);
  }
  await Bun.write(paths.skill, Bun.file(`${root}/skills/pr-health/SKILL.md`));
  await rm(paths.legacyBinary, { force: true });
  console.log(`Installed toolkit to ${paths.binary}`);
}
