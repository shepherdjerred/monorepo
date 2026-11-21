import { expect, test } from "vitest";
import {
  acceptedDeployment,
  useDeliveryFixture,
} from "#testing/delivery-fixture.ts";
import { fixtureEnrichment } from "#testing/enrichment-fixture.ts";
import { workerFixture } from "#testing/worker-fixture.ts";

const context = useDeliveryFixture();

const scoutImage = (digit: string) =>
  `docker.io/shepherdjerred/scout-for-lol@sha256:${digit.padStart(64, "0")}`;

/** The runtime of Scout production, whose accepted pool runs builds 1 and 2. */
async function runtime(live: string[], prepare?: () => Promise<unknown>) {
  const workers = await workerFixture(context.delivery, "scout-prod");
  const pool = await workers.acceptedPool();
  await prepare?.();
  const result = await fixtureEnrichment(context.delivery.database, {
    [workers.host.application]: live,
  }).runtime(workers.environmentId);
  if (result.state !== "available")
    throw new Error(`Runtime is ${result.reason}: ${result.detail}`);
  return { pool, checks: result.data.imageChecks };
}

test("a worker pool's retained build running beside the accepted one matches", async () => {
  const { pool, checks } = await runtime([scoutImage("1"), scoutImage("2")]);
  expect(pool.workerA.image).toBe(scoutImage("1"));
  expect(pool.workerB.image).toBe(scoutImage("2"));
  expect(checks).toEqual([
    {
      component: "image:scout-for-lol",
      expected: pool.workerB.digest,
      live: [scoutImage("1"), scoutImage("2")],
      retained: 1,
      unexpected: [],
      matches: true,
    },
  ]);
});

test("a retained build running without the accepted one does not match", async () => {
  const { checks } = await runtime([scoutImage("1")]);
  expect(checks).toMatchObject([
    { retained: 1, unexpected: [], matches: false },
  ]);
});

test("an image no retained worker explains is unexpected", async () => {
  const { checks } = await runtime([
    scoutImage("1"),
    scoutImage("2"),
    scoutImage("9"),
  ]);
  expect(checks).toMatchObject([
    { retained: 1, unexpected: [scoutImage("9")], matches: false },
  ]);
});

test("a retired worker's image no longer counts as retained", async () => {
  const { checks } = await runtime([scoutImage("1"), scoutImage("2")], () =>
    context.delivery.database.workerVersion.updateMany({
      where: { artifact: { digest: `sha256:${"1".padStart(64, "0")}` } },
      data: { replicas: 0, retiredAt: new Date() },
    }),
  );
  expect(checks).toMatchObject([
    { retained: 0, unexpected: [scoutImage("1")], matches: false },
  ]);
});

test("an environment with no worker pool compares only its accepted artifact", async () => {
  const { fixture, delivery } = context;
  await acceptedDeployment(context, fixture.versionSet.id);
  const image = Object.values(fixture.versionSet.components).find(
    (artifact) => artifact.kind === "image",
  );
  if (image === undefined) throw new Error("fixture selects an Arcade image");
  const read = (live: string[]) =>
    fixtureEnrichment(delivery.database, { arcade: live }).runtime(
      fixture.environment.id,
    );
  const other = `${image.uri}@sha256:${"c".repeat(64)}`;
  expect(await read([`${image.uri}@${image.digest}`])).toMatchObject({
    state: "available",
    data: {
      imageChecks: [{ retained: 0, unexpected: [], matches: true }],
    },
  });
  expect(await read([`${image.uri}@${image.digest}`, other])).toMatchObject({
    state: "available",
    data: {
      imageChecks: [{ retained: 0, unexpected: [other], matches: false }],
    },
  });
});
