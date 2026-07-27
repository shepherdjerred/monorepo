import path from "node:path";
import { parseCoverageSummaries } from "./migration-core.ts";

const minimumCoverage = 90;
const repositoryRoot = path.resolve(import.meta.dir, "..");
const packageDirectories = [
  "scripts",
  "packages/astro-opengraph-images",
  "packages/discord-plays-mario-kart",
  "packages/discord-plays-pokemon",
  "packages/dotfiles",
  "packages/homelab",
  "packages/llm-observability",
  "packages/scout-for-lol",
  "packages/tasks-for-obsidian",
  "packages/toolkit",
] as const;

async function checkPackage(packageDirectory: string): Promise<void> {
  const child = Bun.spawn(["bun", "run", "test:coverage"], {
    cwd: path.join(repositoryRoot, packageDirectory),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  await Bun.stdout.write(stdout);
  await Bun.stderr.write(stderr);
  if (exitCode !== 0) {
    throw new Error(`${packageDirectory} coverage command failed`);
  }
  const summaries = parseCoverageSummaries(`${stdout}\n${stderr}`);
  if (summaries.length === 0) {
    throw new Error(`${packageDirectory} emitted no Bun coverage summary`);
  }
  for (const summary of summaries) {
    if (
      summary.functions < minimumCoverage ||
      summary.lines < minimumCoverage
    ) {
      throw new Error(
        `${packageDirectory} coverage is below ${minimumCoverage.toString()}%: ${summary.functions.toFixed(2)}% functions, ${summary.lines.toFixed(2)}% executable statements/lines`,
      );
    }
  }
}

for (const packageDirectory of packageDirectories) {
  console.log(`Checking migrated scripts in ${packageDirectory}`);
  await checkPackage(packageDirectory);
}
