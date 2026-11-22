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

/** The image artifact a pipeline's build of a service publishes. */
const image = (serviceId: string, pipelineNumber: number) =>
  `${serviceId}/${String(pipelineNumber)}/image`;

/**
 * A CI build of one service at one commit, published and not yet qualified.
 * With `retain`, it ships no new image and keeps that one, as a commit that
 * changed nothing for the service does.
 */
async function register(
  serviceId: string,
  sourceRevision: string,
  pipelineNumber: number,
  retain?: string,
) {
  const build = await context.delivery.publish(
    {
      requestId: `${serviceId}/${String(pipelineNumber)}`,
      serviceId,
      sourceRevision,
      ciUrl: `https://woodpecker.sjer.red/repos/1/pipeline/${String(pipelineNumber)}`,
      verifiedAt: new Date().toISOString(),
      artifacts:
        retain === undefined
          ? [
              {
                id: image(serviceId, pipelineNumber),
                component: "server",
                kind: "image",
                uri: `docker.io/shepherdjerred/${serviceId}`,
                version: `2.0.${String(pipelineNumber)}`,
                digest: `sha256:${pipelineNumber.toString(16).padStart(64, "0")}`,
              },
            ]
          : [],
      retainedArtifactIds: retain === undefined ? [] : [retain],
    },
    testPublisher,
    { repositoryId: 1, pipelineNumber },
  );
  return build.buildId;
}

/** A CI build of one service at one commit, qualified as given. */
async function publish(
  serviceId: string,
  sourceRevision: string,
  pipelineNumber: number,
  outcome: "verified" | "failed",
) {
  const buildId = await register(serviceId, sourceRevision, pipelineNumber);
  await context.delivery.qualify(buildId, outcome, testExecutor);
  return buildId;
}

/**
 * Record a commit's push pipeline, as qualification reads it from Woodpecker.
 * The per-test reset keeps source records, so no other test may use a sha
 * recorded here.
 */
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

  test("a carrier that composed nothing stands where the newer release stands", async () => {
    // Pipelines 900, 901 and 902 hold successive commits. 900 fails; 902
    // qualifies before 901, so 901 composes no set and 902 holds the release.
    const failed = await publish("arcade", sha("1"), 900, "failed");
    const skipped = await register("arcade", sha("2"), 901);
    await publish("arcade", sha("3"), 902, "verified");
    await context.delivery.qualify(skipped, "verified", testExecutor);
    const status = await commitStatus(context.cluster.database, sha("1"));
    expect(status.carriedFailures).toEqual([
      { buildId: failed, includedIn: sha("2") },
    ]);
    const [carried] = status.changed;
    expect(status.changed).toHaveLength(1);
    expect(carried?.includedIn).toBe(sha("3"));
    expect(carried?.versionSet).not.toBeNull();
    expect(carried?.environments.map((entry) => entry.environmentId)).toEqual([
      context.fixture.environment.id,
    ]);
    expect(status.verdict).not.toBe("deployed");
    expect(status.verdict).toBe(carried?.verdict);
  });

  test("a carried failure with no later release is not released, not deployed", async () => {
    // The later passing build keeps the live set's image, so it composes
    // nothing, and no later build of Arcade has a release.
    await publish("arcade", sha("e"), 949, "verified");
    const failed = await publish("arcade", sha("f"), 950, "failed");
    const kept = await register("arcade", sha("0"), 951, image("arcade", 949));
    await context.delivery.qualify(kept, "verified", testExecutor);
    const status = await commitStatus(context.cluster.database, sha("f"));
    expect(status.carriedFailures).toEqual([
      { buildId: failed, includedIn: sha("0") },
    ]);
    expect(status.changed).toEqual([
      expect.objectContaining({
        versionSet: null,
        environments: [],
        verdict: "waiting",
        includedIn: sha("0"),
      }),
    ]);
    expect(status.verdict).toBe("waiting");
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
