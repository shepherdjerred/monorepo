import { afterEach, beforeAll, expect, test } from "vitest";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { createMovieHistoryFixture } from "#testing/movie-workflow/history/history-review-fixture.ts";
import { eligibleBindingTarget } from "#infrastructure/recovery/legacy-claims/bindings.ts";

let bytes: Uint8Array;
const closers: (() => Promise<void>)[] = [];
beforeAll(async () => {
  bytes = await movieVideoFixture();
});
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

test("real independent PIN accounts map exact current server IDs without gaining managed-profile identity", async () => {
  const f = await createMovieHistoryFixture("directors_cut", bytes);
  closers.push(f.close);
  expect(f.household).toHaveLength(2);
  for (const [index, person] of f.household.entries()) {
    const current = await f.db.mediaUser.findUniqueOrThrow({
      where: { id: person.id },
      include: { plexIdentity: true },
    });
    if (current.plexIdentity === null)
      throw new Error(
        "Real independent mapping producer omitted its account mapping",
      );
    expect(current.plexIdentity).toMatchObject({
      kind: "account",
      homeUserId: null,
      serverAccountId: String(index + 1),
      serverMachineId: f.settings.serverMachineId,
      plexRestricted: false,
    });
    expect(eligibleBindingTarget(current, f.settings.serverMachineId)).toBe(
      true,
    );
    expect(
      await f.db.applicationEvent.findFirstOrThrow({
        where: {
          kind: "plex_profile_mapped",
          payload: { path: ["userId"], equals: person.id },
        },
      }),
    ).toMatchObject({
      actorId: f.owner.id,
      payload: {
        userId: person.id,
        homeUserId: person.plexAccountId,
        serverAccountId: String(index + 1),
      },
    });
    await expect(
      f.profileAdmin.saveProfile(f.owner, crypto.randomUUID(), {
        homeUserId: person.plexAccountId,
        serverAccountId: "999999",
        expectedVersion: current.plexIdentity.version,
        confirmedIdentity: true,
      }),
    ).rejects.toMatchObject({ code: "plex_mapping_changed" });
    expect(
      await f.db.mediaUser.findUniqueOrThrow({
        where: { id: person.id },
        include: { plexIdentity: true },
      }),
    ).toEqual(current);
  }
  expect(
    await f.db.mediaRequest.count({ where: { mediaId: f.scope.mediaId } }),
  ).toBe(0);
  expect(
    await f.db.movieEditionChoice.count({
      where: { rootMediaId: f.scope.mediaId },
    }),
  ).toBe(0);
  expect(await f.db.recoveryReleaseReceipt.count()).toBe(0);
}, 60_000);
