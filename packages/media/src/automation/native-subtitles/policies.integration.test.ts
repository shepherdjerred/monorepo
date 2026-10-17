import { defaultScope } from "#shared/editions/scope.ts";
import { targetWhere } from "#infrastructure/editions/targets.ts";
import { lockDefaultScopes } from "#infrastructure/editions/locks.ts";
import { expect, test } from "vitest";
import { nativeSubtitleHarness } from "./test-fixture.ts";
import {
  snapshotNativeSubtitlePolicies,
  appendNativeSubtitlePolicies,
} from "./policies.ts";
import { currentSubtitlePolicies } from "#infrastructure/subtitle-policy.ts";

const harness = nativeSubtitleHarness();
const rules = {
  schemaVersion: 1,
  protectedReasons: [],
  targets: [
    {
      sourceItemId: 1,
      language: "en",
      audioLanguage: "en",
      forced: false,
      hearingImpaired: "any",
      audio: "any",
    },
  ],
};

test("reviewed inherited policy renewal appends only selected media and preserves every old row and unselected sibling epoch", async () => {
  const series = await harness.database().mediaItem.create({
    data: {
      kind: "series",
      title: "Coastlines",
      year: 2026,
      tmdbId: 1234,
    },
  });
  const f = await harness.setup("accepted", false, { seriesId: series.id });
  await f.db.$transaction((tx) =>
    lockDefaultScopes(tx, [defaultScope(series.id)], { createMissing: true }),
  );
  const sibling = await f.db.mediaItem.create({
    data: {
      kind: "episode",
      title: "Unselected episode",
      parentId: series.id,
      seasonNumber: 1,
      episodeNumber: 2,
    },
  });
  const prior = await f.db.mediaSubtitlePolicyVersion.create({
    data: {
      mediaId: series.id,
      actorId: f.user.id,
      version: 0,
      recoveryEpoch: 0,
      source: { sourceProfile: "exact prior owner choice" },
      rules,
    },
  });
  const reviewed = await snapshotNativeSubtitlePolicies(f.db, [f.media.id]);
  expect(reviewed).toEqual([
    expect.objectContaining({
      mediaId: f.media.id,
      localPolicyId: null,
      localVersion: -1,
      effective: expect.objectContaining({ id: prior.id, mediaId: series.id }),
    }),
  ]);
  const operationCount = await f.db.operation.count();
  const result = await f.db.$transaction((tx) =>
    appendNativeSubtitlePolicies(tx, {
      policies: reviewed,
      epoch: 1,
      actorId: f.user.id,
      planId: crypto.randomUUID(),
    }),
  );
  expect(result).toHaveLength(1);
  const renewed = await f.db.mediaSubtitlePolicyVersion.findUniqueOrThrow({
    where: { id: result[0]?.policyId ?? "missing" },
  });
  expect(renewed).toMatchObject({
    mediaId: f.media.id,
    version: 0,
    recoveryEpoch: 1,
    rules: prior.rules,
    source: { priorPolicyId: prior.id, provenance: prior.source },
  });
  expect(
    await f.db.mediaSubtitlePolicyVersion.findUniqueOrThrow({
      where: { id: prior.id },
    }),
  ).toEqual(prior);
  expect(await currentSubtitlePolicies(f.db, [sibling.id])).toMatchObject([
    { id: prior.id, recoveryEpoch: 0 },
  ]);
  expect(
    await f.db.mediaIntent.findUniqueOrThrow({
      where: targetWhere(defaultScope(f.media.id)),
    }),
  ).toMatchObject({ automationEpoch: 0 });
  expect(await f.db.operation.count()).toBe(operationCount);
  expect(
    await f.db.recoveryHold.findUniqueOrThrow({
      where: targetWhere(defaultScope(f.media.id)),
    }),
  ).toMatchObject({ releasedAt: null, recoveryEpoch: 1 });
  await expect(
    f.db.mediaSubtitlePolicyVersion.update({
      where: { id: prior.id },
      data: { recoveryEpoch: 1 },
    }),
  ).rejects.toThrow();
});

test("policy changes after review protect renewal rather than silently approving different rules", async () => {
  const f = await harness.setup();
  const prior = await f.db.mediaSubtitlePolicyVersion.create({
    data: {
      mediaId: f.media.id,
      actorId: f.user.id,
      version: 0,
      recoveryEpoch: 0,
      source: { fixture: true },
      rules,
    },
  });
  const reviewed = await snapshotNativeSubtitlePolicies(f.db, [f.media.id]);
  await f.db.mediaSubtitlePolicyVersion.create({
    data: {
      mediaId: f.media.id,
      actorId: f.user.id,
      version: 1,
      recoveryEpoch: 0,
      source: { changed: true },
      rules: { ...rules, targets: [] },
    },
  });
  await expect(
    f.db.$transaction((tx) =>
      appendNativeSubtitlePolicies(tx, {
        policies: reviewed,
        epoch: 1,
        actorId: f.user.id,
        planId: crypto.randomUUID(),
      }),
    ),
  ).rejects.toThrow("changed after owner review");
  expect(
    await f.db.mediaSubtitlePolicyVersion.count({
      where: { mediaId: f.media.id },
    }),
  ).toBe(2);
  expect(
    await f.db.mediaSubtitlePolicyVersion.findUniqueOrThrow({
      where: { id: prior.id },
    }),
  ).toEqual(prior);
});

test("reviewed absence remains absence and creates no policy or household demand", async () => {
  const f = await harness.setup();
  const reviewed = await snapshotNativeSubtitlePolicies(f.db, [f.media.id]);
  expect(reviewed).toMatchObject([{ effective: null, localVersion: -1 }]);
  expect(
    await f.db.$transaction((tx) =>
      appendNativeSubtitlePolicies(tx, {
        policies: reviewed,
        epoch: 1,
        actorId: f.user.id,
        planId: crypto.randomUUID(),
      }),
    ),
  ).toEqual([]);
  expect(
    await f.db.mediaSubtitlePolicyVersion.count({
      where: { mediaId: f.media.id },
    }),
  ).toBe(0);
});
