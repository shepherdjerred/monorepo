/**
 * Local harness for the Glitter context refresh activity (no Temporal server).
 *
 * Runs the exact `refreshGlitterContext` activity the scheduled workflow runs,
 * under a mock activity context, so an operator can reproduce a failing
 * extraction or synthesis against the shared generation-artifact cache without
 * waiting for a worker image to ship. Cached artifacts are keyed by request
 * digest, not by run, so a local run reuses everything a production run already
 * paid for.
 *
 * Requires GLITTER_DISCORD_GUILD_ID, the GLITTER_CORPUS_S3_* credentials, and
 * OPENROUTER_API_KEY. A non-dry run additionally opens a pull request and needs
 * the GITHUB_APP_* credentials.
 */
import { MockActivityEnvironment } from "@temporalio/testing";
import { glitterContextRefreshActivities } from "#activities/glitter/context/glitter-context-refresh.ts";
import type { GlitterContextRefreshInput } from "#activities/glitter/context/glitter-context-refresh.ts";

function parseArguments(argv: readonly string[]): GlitterContextRefreshInput {
  let dryRun = true;
  let maxEstimatedCostUsd = 10;
  let snapshotId: string | undefined;
  let snapshotSha256: string | undefined;
  let now: string | undefined;
  for (const argument of argv) {
    const [flag, value] = splitFlag(argument);
    switch (flag) {
      case "--dry-run": {
        dryRun = value !== "false";
        break;
      }
      case "--max-cost-usd": {
        maxEstimatedCostUsd = Number(value);
        break;
      }
      case "--snapshot-id": {
        snapshotId = value;
        break;
      }
      case "--snapshot-sha256": {
        snapshotSha256 = value;
        break;
      }
      case "--now": {
        now = value;
        break;
      }
      default: {
        throw new Error(`Unknown argument: ${argument}`);
      }
    }
  }
  if ((snapshotId === undefined) !== (snapshotSha256 === undefined)) {
    throw new Error(
      "--snapshot-id and --snapshot-sha256 must be supplied together",
    );
  }
  return {
    dryRun,
    maxEstimatedCostUsd,
    ...(now === undefined ? {} : { now }),
    ...(snapshotId === undefined || snapshotSha256 === undefined
      ? {}
      : { snapshot: { snapshotId, snapshotSha256 } }),
  };
}

function splitFlag(argument: string): [string, string | undefined] {
  const separator = argument.indexOf("=");
  return separator === -1
    ? [argument, undefined]
    : [argument.slice(0, separator), argument.slice(separator + 1)];
}

const input = parseArguments(process.argv.slice(2));
const environment = new MockActivityEnvironment({
  workflowExecution: {
    workflowId: "glitter-context-refresh-local",
    runId: crypto.randomUUID(),
  },
});
environment.on("heartbeat", (details: unknown) => {
  console.warn(`heartbeat ${JSON.stringify(details)}`);
});
// Called through its owning object rather than detached, so `this` stays bound.
const result = await environment.run(
  async (activityInput: GlitterContextRefreshInput) =>
    await glitterContextRefreshActivities.refreshGlitterContext(activityInput),
  input,
);
console.warn(JSON.stringify(result, null, 2));
