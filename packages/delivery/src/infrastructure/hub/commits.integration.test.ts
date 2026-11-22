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

/** A CI build of one service at one commit, qualified as given. */
async function publish(
  serviceId: string,
  sourceRevision: string,
  pipelineNumber: number,
  outcome: "verified" | "failed",
) {
  const build = await context.delivery.publish(
    {
      requestId: `${serviceId}/${String(pipelineNumber)}`,
      serviceId,
      sourceRevision,
      ciUrl: `https://woodpecker.sjer.red/repos/1/pipeline/${String(pipelineNumber)}`,
      verifiedAt: new Date().toISOString(),
      artifacts: [
        {
          id: `${serviceId}/${String(pipelineNumber)}/image`,
          component: "server",
          kind: "image",
          uri: `docker.io/shepherdjerred/${serviceId}`,
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
    const failed = await publish("golink", sha("1"), 500, "failed");
    await publish("golink", sha("2"), 501, "verified");
    await publish("golink", sha("3"), 502, "verified");
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
    const older = await publish("golink", sha("4"), 400, "failed");
    await pushed(sha("4"), 400, older);
    const failed = await publish("golink", sha("5"), 600, "failed");
    await publish("golink", sha("4"), 601, "verified");
    const before = await commitStatus(context.cluster.database, sha("5"));
    expect(before.carriedFailures).toEqual([]);
    expect(before.verdict).toBe("build_failed");
    await publish("golink", sha("6"), 602, "verified");
    const status = await commitStatus(context.cluster.database, sha("5"));
    expect(status.carriedFailures).toEqual([
      { buildId: failed, includedIn: sha("6") },
    ]);
    expect(status.verdict).toBe("nothing_to_deploy");
  });

  test("a carried failure stands where the carrying release stands, not deployed", async () => {
    // Arcade has a prod environment that accepted an older release: the
    // carrying commit's Arcade release is not live there yet.
    const failed = await publish("arcade", sha("c"), 800, "failed");
    await publish("arcade", sha("d"), 801, "verified");
    const status = await commitStatus(context.cluster.database, sha("c"));
    expect(status.carriedFailures).toEqual([
      { buildId: failed, includedIn: sha("d") },
    ]);
    expect(status.changed.map((entry) => entry.includedIn)).toEqual([sha("d")]);
    const [carried] = status.changed;
    expect(carried?.service.id).toBe("arcade");
    expect(carried?.environments.map((entry) => entry.environmentId)).toEqual([
      context.fixture.environment.id,
    ]);
    expect(carried?.environments.some((entry) => entry.state === "live")).toBe(
      false,
    );
    expect(status.verdict).not.toBe("deployed");
    expect(status.verdict).toBe(carried?.verdict);
    expect(status.blocker?.service).toBe(carried?.service.title);
  });

  test("a failure nothing later carries keeps the CI failed verdict", async () => {
    await publish("golink", sha("7"), 700, "verified");
    const failed = await publish("golink", sha("8"), 701, "failed");
    const status = await commitStatus(context.cluster.database, sha("8"));
    expect(status.failedBuilds.map((build) => build.id)).toEqual([failed]);
    expect(status.carriedFailures).toEqual([]);
    expect(status.verdict).toBe("build_failed");
  });
});
