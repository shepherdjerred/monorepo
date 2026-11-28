import { expect, test, vi } from "vitest";
import type { MediaActor } from "#application/auth.ts";
import { createDatabase } from "#infrastructure/database.ts";
import { PrismaMediaApplication } from "#infrastructure/media-service.ts";
import { LEAVING_SOON_ATTEMPT_KIND, runCollectionAttempt } from "./attempt.ts";
import { nextCollectionChange } from "./membership.ts";

const member = { ratingKey: "3", guid: "plex://movie/managed" };
const other = { ratingKey: "4", guid: "plex://movie/new" };
const foreign = { ratingKey: "2", guid: "plex://movie/foreign" };

test("records the attempt before touching Plex and acknowledges exact readback", async () => {
  const calls: string[] = [];
  await runCollectionAttempt({
    record: async () => {
      calls.push("reconciling");
      return "attempt";
    },
    applyAndVerify: async () => {
      expect(calls).toEqual(["reconciling"]);
      calls.push("apply", "verify");
    },
    acknowledge: async (id) => {
      expect(id).toBe("attempt");
      calls.push("complete");
    },
  });
  expect(calls).toEqual(["reconciling", "apply", "verify", "complete"]);
});

test("a failed durable record prevents the Plex write", async () => {
  const applyAndVerify = vi.fn<() => Promise<void>>();
  const acknowledge = vi.fn<(id: string) => Promise<void>>();
  await expect(
    runCollectionAttempt({
      record: () => Promise.reject(new Error("record failed")),
      applyAndVerify,
      acknowledge,
    }),
  ).rejects.toThrow("record failed");
  expect(applyAndVerify).not.toHaveBeenCalled();
  expect(acknowledge).not.toHaveBeenCalled();
});

test.each(["readback", "acknowledgement"])(
  "a lost %s leaves the operation unresolved and prevents adopting or replaying the member",
  async (failure) => {
    const known = new Set([foreign.ratingKey]);
    const persisted = new Set<string>();
    await expect(
      runCollectionAttempt({
        record: async () => {
          persisted.add(member.ratingKey);
          return "attempt";
        },
        applyAndVerify: async () => {
          known.add(member.ratingKey);
          if (failure === "readback") throw new Error(failure);
        },
        acknowledge: () => Promise.reject(new Error(failure)),
      }),
    ).rejects.toThrow(failure);
    expect(persisted.has(member.ratingKey)).toBe(true);
    expect(nextCollectionChange([member], [], known, persisted)).toBeNull();
    expect(nextCollectionChange([], [], known, persisted)).toBeNull();
    known.delete(member.ratingKey);
    expect(nextCollectionChange([member], [], known, persisted)).toBeNull();
    expect(nextCollectionChange([member, other], [], known, persisted)).toEqual(
      {
        item: other,
        present: true,
      },
    );
  },
);

test("an unresolved removal cannot remove the same rating key again", () => {
  const known = new Set([foreign.ratingKey, member.ratingKey, other.ratingKey]);
  const persisted = new Set([member.ratingKey]);
  expect(nextCollectionChange([], [member, other], known, persisted)).toEqual({
    item: other,
    present: false,
  });
  expect(nextCollectionChange([], [member], known, persisted)).toBeNull();
});

test("the owner Activity read reserves room for unresolved collection work", async () => {
  // All three delegates used by the Activity read are stubbed and never reach a database.
  const db = createDatabase("postgresql://127.0.0.1:1/unused");
  const owner: MediaActor = {
    id: "fixture-owner",
    role: "owner",
    restricted: false,
    displayName: "Owner",
    plexAccountId: "fixture",
    version: 0,
  };
  const pending = {
    id: "old-attempt",
    idempotencyKey: null,
    userId: null,
    kind: LEAVING_SOON_ATTEMPT_KIND,
    targetId: "fixture-collection",
    payload: {},
    result: null,
    status: "reconciling",
    createdAt: new Date("2026-11-20T00:00:00.000Z"),
    updatedAt: new Date("2026-11-20T00:00:00.000Z"),
  } as const;
  const find = vi
    .spyOn(db.operation, "findMany")
    .mockResolvedValueOnce([pending])
    .mockResolvedValue([]);
  vi.spyOn(db.mediaItem, "findMany").mockResolvedValue([]);
  const service = new PrismaMediaApplication(db, { keepDays: 30 });
  try {
    expect(await service.activity(owner)).toEqual([
      expect.objectContaining({ id: pending.id, status: pending.status }),
    ]);
    expect(find).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        take: 99,
        where: {
          NOT: { kind: LEAVING_SOON_ATTEMPT_KIND, status: "reconciling" },
        },
      }),
    );
    find.mockClear();
    const memberActor = {
      ...owner,
      id: "fixture-member",
      role: "member",
    } as const;
    expect(await service.activity(memberActor)).toEqual([]);
    expect(find).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        take: 100,
        where: { userId: memberActor.id },
      }),
    );
  } finally {
    await db.$disconnect();
  }
});
