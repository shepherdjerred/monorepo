import { z } from "zod";

const BUILDKITE_PIPELINE = "sjerred/monorepo";

const BuildkiteBuildSummarySchema = z.object({
  number: z.number(),
  commit: z.string(),
  state: z.string(),
  web_url: z.url(),
});

const BuildkiteJobSchema = z.object({
  id: z.string(),
  name: z.string(),
  state: z.string(),
  web_url: z.url(),
  soft_failed: z.boolean().optional(),
});

const BuildkiteBuildSchema = BuildkiteBuildSummarySchema.extend({
  jobs: z.array(BuildkiteJobSchema),
});

export type BuildkiteBuild = z.infer<typeof BuildkiteBuildSchema>;

async function runBuildkiteJson(args: readonly string[]): Promise<unknown> {
  const child = Bun.spawn(["bk", ...args], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...Bun.env,
      BUILDKITE_ORGANIZATION_SLUG:
        Bun.env["BUILDKITE_ORGANIZATION_SLUG"] ?? "sjerred",
    },
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) {
    const detail = stderr.trim();
    throw new Error(
      detail.length > 0
        ? `bk failed: ${detail}`
        : `bk exited with code ${String(exitCode)}`,
    );
  }
  return Bun.JSONC.parse(stdout);
}

export async function getBuildkiteBuildForCommit(
  headSha: string,
): Promise<BuildkiteBuild | null> {
  const listed = z
    .array(BuildkiteBuildSummarySchema)
    .parse(
      await runBuildkiteJson([
        "build",
        "list",
        "--pipeline",
        BUILDKITE_PIPELINE,
        "--commit",
        headSha,
        "--limit",
        "20",
        "--summary",
        "--json",
      ]),
    );
  const newest = listed
    .filter((build) => build.commit === headSha)
    .toSorted((left, right) => right.number - left.number)[0];
  if (newest === undefined) {
    return null;
  }

  const build = BuildkiteBuildSchema.parse(
    await runBuildkiteJson([
      "build",
      "view",
      String(newest.number),
      "--pipeline",
      BUILDKITE_PIPELINE,
      "--json",
    ]),
  );
  if (build.commit !== headSha) {
    throw new Error(
      `Buildkite build #${String(build.number)} is for ${build.commit}, expected ${headSha}`,
    );
  }
  return build;
}
