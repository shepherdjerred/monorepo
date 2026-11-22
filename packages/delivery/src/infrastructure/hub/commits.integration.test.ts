import { describe, expect, test } from "vitest";
import { commitStatus } from "#infrastructure/hub/commits.ts";
import { useDeliveryFixture } from "#testing/delivery-fixture.ts";
import { testExecutor, testPublisher } from "#testing/seed.ts";

/**
 * A commit whose CI failed is not built on its own when a later main commit
 * that includes it passed: its change shipped in that commit, so the failure
 * does not decide its verdict. Golink has no environment here, so a passing
 * build composes a set and deploys nothing.
 */
const context = useDeliveryFixture();

const sha = (digit: string) => digit.repeat(40);

async function golink(
  sourceRevision: string,
  pipelineNumber: number,
  outcome: "verified" | "failed",
) {
  const build = await context.delivery.publish(
    {
      requestId: `golink/${String(pipelineNumber)}`,
      serviceId: "golink",
      sourceRevision,
      ciUrl: `https://woodpecker.sjer.red/repos/1/pipeline/${String(pipelineNumber)}`,
      verifiedAt: new Date().toISOString(),
      artifacts: [
        {
          id: `golink/${String(pipelineNumber)}/image`,
          component: "server",
          kind: "image",
          uri: "docker.io/shepherdjerred/golink",
          version: `2.0.${String(pipelineNumber)}`,
          digest: `sha256:${pipelineNumber.toString(16).padStart(64, "0")}`,
        },
      ],
    },
    testPublisher,
    { repositoryId: 1, pipelineNumber },
  );
  await context.delivery.qualify(build.buildId, outcome, testExecutor);
  return build.buildId;
}

/** Record a commit's push pipeline, as qualification reads it from Woodpecker. */
async function pushed(
  sourceRevision: string,
  pipelineNumber: number,
  buildId: string,
) {
  await context.delivery.recordSourceCommit({
    sourceRevision,
    message: "feat(golink): a change",
    author: "fixture",
    pipelineNumber,
    buildId,
    actor: testExecutor,
    requestId: `source/${sourceRevision}`,
  });
}

describe("commit status", () => {
  test("a failed build a later passing commit includes is carried by it", async () => {
    const failed = await golink(sha("1"), 500, "failed");
    await golink(sha("2"), 501, "verified");
    await golink(sha("3"), 502, "verified");
    const status = await commitStatus(context.cluster.database, sha("1"));
    expect(status.failedBuilds.map((build) => build.id)).toEqual([failed]);
    // The first later commit that passed, not the newest.
    expect(status.carriedFailures).toEqual([
      { buildId: failed, includedIn: sha("2") },
    ]);
    expect(status.verdict).toBe("nothing_to_deploy");
  });

  test("a rerun of an older commit does not carry a newer failure", async () => {
    // The older commit was pushed in pipeline 400 and passes only in a
    // rerun numbered after the failure; it does not include the failed one.
    const older = await golink(sha("4"), 400, "failed");
    await pushed(sha("4"), 400, older);
    const failed = await golink(sha("5"), 600, "failed");
    await golink(sha("4"), 601, "verified");
    const before = await commitStatus(context.cluster.database, sha("5"));
    expect(before.carriedFailures).toEqual([]);
    expect(before.verdict).toBe("build_failed");
    await golink(sha("6"), 602, "verified");
    const status = await commitStatus(context.cluster.database, sha("5"));
    expect(status.carriedFailures).toEqual([
      { buildId: failed, includedIn: sha("6") },
    ]);
    expect(status.verdict).toBe("nothing_to_deploy");
  });

  test("a failure nothing later carries keeps the CI failed verdict", async () => {
    await golink(sha("7"), 700, "verified");
    const failed = await golink(sha("8"), 701, "failed");
    const status = await commitStatus(context.cluster.database, sha("8"));
    expect(status.failedBuilds.map((build) => build.id)).toEqual([failed]);
    expect(status.carriedFailures).toEqual([]);
    expect(status.verdict).toBe("build_failed");
  });
});
