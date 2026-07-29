import path from "node:path";
import { sanitizeWorkspace, TestManifestSchema } from "./ci-reporting.ts";
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
const manifest = TestManifestSchema.parse(
  await Bun.file(path.join(import.meta.dir, "ci-test-manifest.json")).json(),
);
const workspaceByDirectory = new Map(
  manifest.workspaces.map((workspace) => [
    workspace.directory,
    workspace.package,
  ]),
);

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
  const workspace = workspaceByDirectory.get(packageDirectory);
  if (workspace === undefined) {
    throw new Error(
      `${packageDirectory} has script coverage but no CI test manifest entry`,
    );
  }
  const lcovPath = path.join(
    repositoryRoot,
    packageDirectory,
    "coverage",
    "lcov.info",
  );
  const lcov = Bun.file(lcovPath);
  if (!(await lcov.exists()) || lcov.size === 0) {
    throw new Error(
      `${packageDirectory} emitted no LCOV report at ${lcovPath}`,
    );
  }
  const destination = path.join(
    repositoryRoot,
    ".ci-reports",
    "coverage",
    "raw",
    sanitizeWorkspace(workspace),
    "script-coverage",
    "lcov.info",
  );
  await Bun.$`mkdir -p ${path.dirname(destination)}`;
  await Bun.write(destination, lcov);
}

for (const packageDirectory of packageDirectories) {
  console.log(`Checking migrated scripts in ${packageDirectory}`);
  await checkPackage(packageDirectory);
}
