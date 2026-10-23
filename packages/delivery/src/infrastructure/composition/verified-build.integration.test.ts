import { describe, expect, test } from "vitest";
import { useDeliveryFixture } from "#testing/delivery-fixture.ts";
import { composeVerifiedBuild } from "./verified-build.ts";
import { liveSet } from "./automatic.ts";

const context = useDeliveryFixture();
const PIPELINE = 700;

/** A verified build of the fixture service in `PIPELINE`, with its artifacts registered. */
async function verifiedBuild(
  name: string,
  sourceKind: "upstream" | "ci",
  components: string[],
  selected: Record<string, string> = {},
) {
  const db = context.cluster.database;
  const build = await db.build.create({
    data: {
      id: name,
      requestId: name,
      serviceId: context.fixture.environment.serviceId,
      sourceRevision: "a".repeat(40),
      sourceKind,
      status: "verified",
      verifiedAt: new Date(),
      repositoryId: 1,
      pipelineNumber: PIPELINE,
      ciUrl:
        sourceKind === "ci"
          ? `https://woodpecker.sjer.red/repos/1/pipeline/${String(PIPELINE)}`
          : null,
    },
  });
  for (const [index, component] of components.entries())
    await db.artifact.create({
      data: {
        id: `${name}/${component}`,
        buildId: build.id,
        component,
        kind: "image",
        uri: `docker.io/shepherdjerred/${name}`,
        store: "docker-hub",
        digest: `sha256:${(name.length * 100 + index).toString(16).padStart(64, "0")}`,
        version: "1.0.0",
      },
    });
  for (const [component, artifactId] of Object.entries(selected))
    await db.buildArtifactSelection.create({
      data: { buildId: build.id, component, artifactId },
    });
  return build;
}

async function compose(build: Awaited<ReturnType<typeof verifiedBuild>>) {
  return context.cluster.database.$transaction(
    async (tx) => await composeVerifiedBuild(tx, build),
  );
}

describe("order keys within one pipeline (B4, R4)", () => {
  test("each acquisition and the grouped CI publication of a pipeline key apart, and the live set is the last", async () => {
    const chart = await verifiedBuild("acquired-chart", "upstream", [
      "chart:velero",
    ]);
    const plugin = await verifiedBuild("acquired-plugin", "upstream", [
      "image:velero-plugin",
    ]);
    const grouped = await verifiedBuild("grouped-ci", "ci", ["image:server"], {
      "chart:velero": "acquired-chart/chart:velero",
      "image:velero-plugin": "acquired-plugin/image:velero-plugin",
      "image:server": "grouped-ci/image:server",
    });
    const sets = [
      await compose(chart),
      await compose(plugin),
      await compose(grouped),
    ];
    const keys = sets.map((set) => [set?.orderMajor, set?.orderMinor]);
    expect(keys.map(([major]) => major)).toEqual([
      PIPELINE,
      PIPELINE,
      PIPELINE,
    ]);
    // Registered in this order, so each keys after the one before (B4).
    expect(keys.map(([, minor]) => minor)).toEqual([
      chart.registrationSequence,
      plugin.registrationSequence,
      grouped.registrationSequence,
    ]);
    expect(new Set(keys.map(([, minor]) => minor)).size).toBe(3);
    const live = await liveSet(
      context.cluster.database,
      context.fixture.environment.serviceId,
    );
    expect(live?.id).toBe(sets[2]?.id);
    expect(
      Object.fromEntries(
        (live?.entries ?? []).map((entry) => [
          entry.component,
          entry.artifactId,
        ]),
      ),
    ).toMatchObject({
      "chart:velero": "acquired-chart/chart:velero",
      "image:velero-plugin": "acquired-plugin/image:velero-plugin",
      "image:server": "grouped-ci/image:server",
    });
  });

  test("an acquisition registered before its pipeline's publication but qualified after it composes nothing", async () => {
    const plugin = await verifiedBuild("late-plugin", "upstream", [
      "image:velero-plugin",
    ]);
    const grouped = await verifiedBuild("early-ci", "ci", ["image:server"], {
      "image:server": "early-ci/image:server",
    });
    const published = await compose(grouped);
    expect(published).not.toBeNull();
    // Registered before the grouped publication, so it keys below it (R4).
    expect(await compose(plugin)).toBeNull();
    const live = await liveSet(
      context.cluster.database,
      context.fixture.environment.serviceId,
    );
    expect(live?.id).toBe(published?.id);
  });
});
