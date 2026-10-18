import { expect, test } from "vitest";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import {
  numberingFixture,
  commitNumberingInput,
} from "./numbering-test-fixture.ts";

const harness = automationTestHarness();
test("explicit subgroup/start interpretation joins exact TMDB IDs and preserves canonical coordinates, unrelated JSON and provenance", async () => {
  const f = await numberingFixture(harness.database());
  const preview = await f.service.previewGroup(
    f.actor,
    f.series.id,
    f.interpretation,
  );
  expect(
    preview.mappings.map((item) => [item.rawOrder, item.absoluteNumber]),
  ).toEqual([
    [42, 123],
    [43, 124],
  ]);
  expect(preview.mappings[0]?.seasonNumber).toBe(0);
  expect(
    await f.service.commitGroup(
      f.actor,
      crypto.randomUUID(),
      f.series.id,
      commitNumberingInput(preview),
    ),
  ).toMatchObject({ status: "completed" });
  const first = await f.db.mediaItem.findUniqueOrThrow({
    where: { id: z.uuid().parse(preview.mappings[0]?.episodeId) },
  });
  expect(first).toMatchObject({
    seasonNumber: 0,
    episodeNumber: 1,
    version: 1,
    externalIds: {
      plexSectionId: "2",
      absoluteNumber: 123,
      numberingProvenance: {
        kind: "tmdb_group",
        subgroupOrder: 7,
        episodeOrder: 42,
        firstAbsoluteNumber: 123,
        groupDigest: preview.groupDigest,
      },
    },
  });
  expect(
    await f.db.mediaItem.findUniqueOrThrow({ where: { id: f.series.id } }),
  ).toMatchObject({ version: 1 });
});

test("manual mappings require exact override acknowledgement even if the proposed number agrees", async () => {
  const f = await numberingFixture(harness.database());
  const episode = f.episodes[0];
  if (episode === undefined) throw new Error("Missing fixture episode");
  await f.manual.save(f.actor, crypto.randomUUID(), episode.id, {
    expectedVersion: 0,
    absoluteNumber: 123,
    evidence: "Explicit owner numbering evidence",
  });
  const preview = await f.service.previewGroup(
    f.actor,
    f.series.id,
    f.interpretation,
  );
  expect(preview.mappings[0]).toMatchObject({
    requiresOverride: true,
    existingProvenance: { kind: "owner" },
  });
  await expect(
    f.service.commitGroup(f.actor, crypto.randomUUID(), f.series.id, {
      ...commitNumberingInput(preview),
      overrideEpisodeIds: [],
    }),
  ).rejects.toMatchObject({ code: "numbering_override_required" });
  await expect(
    f.service.commitGroup(
      f.actor,
      crypto.randomUUID(),
      f.series.id,
      commitNumberingInput(preview),
    ),
  ).resolves.toMatchObject({ status: "completed" });
});

test("a conflicting absolute number outside the selected subgroup protects the entire batch", async () => {
  const f = await numberingFixture(harness.database());
  await f.db.mediaItem.create({
    data: {
      kind: "episode",
      parentId: f.series.id,
      title: "Outside group",
      tmdbId: 900_000 + z.int().parse(f.series.tmdbId),
      seasonNumber: 2,
      episodeNumber: 1,
      externalIds: {
        absoluteNumber: 123,
        numberingEvidence: "Historical explicit owner mapping",
      },
    },
  });
  const preview = await f.service.previewGroup(
    f.actor,
    f.series.id,
    f.interpretation,
  );
  await expect(
    f.service.commitGroup(
      f.actor,
      crypto.randomUUID(),
      f.series.id,
      commitNumberingInput(preview),
    ),
  ).rejects.toMatchObject({ code: "numbering_conflict" });
  expect(
    await f.db.mediaItem.count({
      where: { parentId: f.series.id, version: 1 },
    }),
  ).toBe(0);
});

test("group response drift and a concurrent actual manual command each invalidate the old preview", async () => {
  const f = await numberingFixture(harness.database());
  const preview = await f.service.previewGroup(
    f.actor,
    f.series.id,
    f.interpretation,
  );
  f.group.name = "Changed upstream description";
  await expect(
    f.service.commitGroup(
      f.actor,
      crypto.randomUUID(),
      f.series.id,
      commitNumberingInput(preview),
    ),
  ).rejects.toMatchObject({ code: "numbering_preview_changed" });
  f.group.name = "Fixture Absolute";
  f.hooks.beforeDetail = async () => {
    f.hooks.beforeDetail = () => Promise.resolve();
    await f.manual.save(
      f.actor,
      crypto.randomUUID(),
      z.uuid().parse(f.episodes[0]?.id),
      {
        expectedVersion: 0,
        absoluteNumber: 555,
        evidence: "Concurrent explicit owner numbering",
      },
    );
  };
  await expect(
    f.service.commitGroup(
      f.actor,
      crypto.randomUUID(),
      f.series.id,
      commitNumberingInput(preview),
    ),
  ).rejects.toMatchObject({ code: "numbering_preview_changed" });
});

test.each(["duplicate", "foreign", "missing", "order-gap"] as const)(
  "%s group coordinates never manufacture absolute identity",
  async (kind) => {
    const f = await numberingFixture(harness.database());
    const subgroup = f.group.groups[0];
    const first = subgroup?.episodes[0];
    const second = subgroup?.episodes[1];
    if (first === undefined || second === undefined)
      throw new Error("Missing fixture rows");
    if (kind === "duplicate") second.id = first.id;
    if (kind === "foreign") first.show_id++;
    if (kind === "missing") first.id = 999_999;
    if (kind === "order-gap") second.order += 2;
    await expect(
      f.service.previewGroup(f.actor, f.series.id, f.interpretation),
    ).rejects.toThrow();
  },
);

test("a stale privileged actor cannot commit after database role revocation", async () => {
  const f = await numberingFixture(harness.database());
  const preview = await f.service.previewGroup(
    f.actor,
    f.series.id,
    f.interpretation,
  );
  await f.db.mediaUser.update({
    where: { id: f.actor.id },
    data: { role: "member", version: { increment: 1 } },
  });
  await expect(
    f.service.commitGroup(
      f.actor,
      crypto.randomUUID(),
      f.series.id,
      commitNumberingInput(preview),
    ),
  ).rejects.toMatchObject({ status: 403 });
});

test("101 episodes require two freshly reviewed batches bound to the same complete upstream group", async () => {
  const f = await numberingFixture(harness.database(), 101);
  const first = await f.service.previewGroup(
    f.actor,
    f.series.id,
    f.interpretation,
  );
  expect(first.mappings).toHaveLength(100);
  expect(first.nextOffset).toBe(100);
  await f.service.commitGroup(
    f.actor,
    crypto.randomUUID(),
    f.series.id,
    commitNumberingInput(first),
  );
  const next = await f.service.previewGroup(f.actor, f.series.id, {
    ...f.interpretation,
    offset: 100,
  });
  expect(next.mappings).toHaveLength(1);
  expect(next.groupDigest).toBe(first.groupDigest);
  expect(next.numberingDigest).not.toBe(first.numberingDigest);
  await f.service.commitGroup(
    f.actor,
    crypto.randomUUID(),
    f.series.id,
    commitNumberingInput(next),
  );
  expect(
    await f.db.mediaItem.count({
      where: { parentId: f.series.id, version: 1 },
    }),
  ).toBe(101);
});
