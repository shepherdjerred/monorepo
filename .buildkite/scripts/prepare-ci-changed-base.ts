import { $ } from "bun";
import {
  globalPaths,
  laneMetadata,
  lanePaths,
  selectBase,
} from "./migration-core.ts";

async function laneChanged(base: string, lane: string): Promise<boolean> {
  const paths = lanePaths[lane];
  if (paths === undefined) throw new Error(`Unknown precomputed lane: ${lane}`);
  const child = Bun.spawn(
    ["git", "diff", "--quiet", base, "HEAD", "--", ...globalPaths, ...paths],
    { stdout: "inherit", stderr: "inherit" },
  );
  const exitCode = await child.exited;
  if (exitCode === 0) return false;
  if (exitCode === 1) return true;
  throw new Error(`git diff exited ${exitCode.toString()} for ${lane}`);
}

if (import.meta.main) {
  const token = Bun.env["BUILDKITE_API_TOKEN"];
  if (token === undefined) throw new Error("BUILDKITE_API_TOKEN is required");
  const organization = Bun.env["BUILDKITE_ORGANIZATION_SLUG"] ?? "sjerred";
  const pipeline = Bun.env["BUILDKITE_PIPELINE_SLUG"] ?? "monorepo";
  const rawHead = await $`git rev-parse HEAD`.text();
  const head = Bun.env["BUILDKITE_COMMIT"] ?? rawHead.trim();
  const response = await fetch(
    `https://api.buildkite.com/v2/organizations/${organization}/pipelines/${pipeline}/builds?branch=main&state=passed&per_page=20`,
    {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!response.ok) {
    throw new Error(`Buildkite API returned ${response.status.toString()}`);
  }
  const base = selectBase(await response.json(), head);
  await $`git cat-file -e ${`${base}^{commit}`}`;
  await $`git merge-base --is-ancestor ${base} HEAD`;
  await $`buildkite-agent meta-data set ci-changed-base ${base}`;
  for (const lane of ["playwright", "resume"]) {
    const metadata = laneMetadata(lane, await laneChanged(base, lane), base);
    for (const [key, value] of Object.entries(metadata)) {
      await $`buildkite-agent meta-data set ${key} ${value}`;
    }
  }
  console.log(`CI selector base: ${base}`);
}
