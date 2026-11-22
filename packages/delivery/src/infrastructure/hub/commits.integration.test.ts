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

/** A carried failure as a commit read reports it, named by its service's title. */
const carriedBy = (buildId: string, includedIn: string) => ({
  buildId,
  includedIn,
  serviceTitle: expect.any(String) as unknown,
});

describe("commit status", () => {
  test("a failed build a later passing commit includes is carried by it", async () => {
    const failed = await publish("golink", sha("1"), 500, "failed");
    await publish("golink", sha("2"), 501, "verified");
    await publish("golink", sha("3"), 502, "verified");
    const status = await commitStatus(context.cluster.database, sha("1"));
    expect(status.failedBuilds.map((build) => build.id)).toEqual([failed]);
    // The first later commit that passed, not the newest.
    expect(status.carriedFailures).toEqual([carriedBy(failed, sha("2"))]);
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
    expect(status.carriedFailures).toEqual([carriedBy(failed, sha("6"))]);
    expect(status.verdict).toBe("nothing_to_deploy");
  });

  test("a carried failure stands where the carrying release stands, not deployed", async () => {
    // Arcade has a prod environment that accepted an older release: the
    // carrying commit's Arcade release is not live there yet.
    const failed = await publish("arcade", sha("c"), 800, "failed");
    await publish("arcade", sha("d"), 801, "verified");
    const status = await commitStatus(context.cluster.database, sha("c"));
    expect(status.carriedFailures).toEqual([carriedBy(failed, sha("d"))]);
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
    expect(status.carriedFailures).toEqual([carriedBy(failed, sha("2"))]);
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
    expect(status.carriedFailures).toEqual([carriedBy(failed, sha("0"))]);
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

  test("a commit whose whole pipeline failed stands where the next passing pipeline's releases stand", async () => {
    // Pipeline 1000 failed before it published Arcade: Golink's build, which
    // no environment tracks, is all it recorded. Pipeline 1001 passed and
    // released Arcade, which carries the failed commit's change.
    const failed = await publish("golink", sha("9"), 1000, "failed");
    await publish("golink", sha("1"), 1001, "verified");
    await publish("arcade", sha("1"), 1001, "verified");
    const status = await commitStatus(context.cluster.database, sha("9"));
    expect(status.carriedFailures).toEqual([carriedBy(failed, sha("1"))]);
    // Golink has nowhere to be released, so it decides nothing.
    expect(status.changed.map((entry) => entry.service.id)).toEqual(["arcade"]);
    const [arcade] = status.changed;
    expect(arcade?.includedIn).toBe(sha("1"));
    expect(arcade?.versionSet).not.toBeNull();
    expect(arcade?.environments.map((entry) => entry.environmentId)).toEqual([
      context.fixture.environment.id,
    ]);
    // Never "not released" while that release is what carries it.
    expect(status.verdict).toBe(arcade?.verdict);
    expect(status.verdict).not.toBe("build_failed");
    expect(status.blocker?.service).toBe(arcade?.service.title);
    expect(status.blockers?.[0]).toEqual(status.blocker);
  });

  test("a whole failed pipeline follows a carrying build a newer one superseded to that newer release", async () => {
    // Pipeline 1301 passed and built Arcade, but 1302's Arcade qualified
    // first, so 1301's composed nothing and 1302's release carries it.
    const failed = await publish("golink", sha("9"), 1300, "failed");
    await publish("golink", sha("1"), 1301, "verified");
    const superseded = await register("arcade", sha("1"), 1301);
    await publish("arcade", sha("2"), 1302, "verified");
    await context.delivery.qualify(superseded, "verified", testExecutor);
    const status = await commitStatus(context.cluster.database, sha("9"));
    expect(status.carriedFailures).toEqual([carriedBy(failed, sha("1"))]);
    const [arcade, ...rest] = status.changed;
    expect(rest).toEqual([]);
    expect(arcade?.service.id).toBe("arcade");
    expect(arcade?.includedIn).toBe(sha("2"));
    expect(arcade?.versionSet).not.toBeNull();
    expect(status.verdict).toBe(arcade?.verdict);
  });

  test("a whole failed pipeline takes no row from a carrying build that only kept earlier artifacts", async () => {
    await publish("arcade", sha("7"), 1399, "verified");
    await publish("golink", sha("9"), 1400, "failed");
    await publish("golink", sha("1"), 1401, "verified");
    const kept = await register(
      "arcade",
      sha("1"),
      1401,
      image("arcade", 1399),
    );
    await context.delivery.qualify(kept, "verified", testExecutor);
    const status = await commitStatus(context.cluster.database, sha("9"));
    expect(status.changed).toEqual([]);
    expect(status.verdict).toBe("nothing_to_deploy");
  });

  test("a commit whose pipeline passed for some services takes no other commit's releases", async () => {
    const failed = await publish("golink", sha("9"), 1100, "failed");
    await publish("birmel", sha("9"), 1100, "verified");
    await publish("golink", sha("1"), 1101, "verified");
    await publish("arcade", sha("1"), 1101, "verified");
    const status = await commitStatus(context.cluster.database, sha("9"));
    expect(status.carriedFailures).toEqual([carriedBy(failed, sha("1"))]);
    expect(status.changed.some((entry) => entry.service.id === "arcade")).toBe(
      false,
    );
  });

  test("a service built twice for one commit counts once, by its newest release", async () => {
    await publish("arcade", sha("9"), 1200, "verified");
    await publish("arcade", sha("9"), 1201, "verified");
    const status = await commitStatus(context.cluster.database, sha("9"));
    expect(status.changed.map((entry) => entry.service.id)).toEqual(["arcade"]);
    const revisions = await context.cluster.database.versionSet.findMany({
      where: { serviceId: "arcade" },
      select: { revision: true },
    });
    expect(status.changed[0]?.versionSet?.revision).toBe(
      Math.max(...revisions.map((row) => row.revision)),
    );
    expect(status.environments.map((group) => group.total)).toEqual([1]);
  });
});
