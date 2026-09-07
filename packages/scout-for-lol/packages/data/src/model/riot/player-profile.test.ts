import { describe, expect, test } from "vitest";
import {
  PLAYER_PROFILE_QUEUE_GROUPS,
  PLAYER_PROFILE_QUEUE_PRESETS,
  PlayerProfileFilterSchema,
  PlayerProfileQueueSelectionSchema,
  QueueTypeSchema,
} from "#src/index.ts";

describe("player profile filters", () => {
  test("defaults to the newest 20 games and no queue predicate", () => {
    expect(PlayerProfileFilterSchema.parse({})).toEqual({ games: 20 });
  });

  test("accepts typed windows and unique non-empty queue selections", () => {
    expect(
      PlayerProfileFilterSchema.parse({
        games: "all",
        queues: ["solo", "flex"],
      }),
    ).toEqual({ games: "all", queues: ["solo", "flex"] });
    expect(PlayerProfileQueueSelectionSchema.safeParse([]).success).toBe(false);
    expect(
      PlayerProfileQueueSelectionSchema.safeParse(["solo", "solo"]).success,
    ).toBe(false);
    expect(
      PlayerProfileQueueSelectionSchema.safeParse(["not-a-queue"]).success,
    ).toBe(false);
  });

  test("groups expose every queue exactly once and presets remain valid", () => {
    const grouped = PLAYER_PROFILE_QUEUE_GROUPS.flatMap(
      (group) => group.queues,
    );
    expect(grouped.toSorted()).toEqual(QueueTypeSchema.options.toSorted());
    expect(new Set(grouped).size).toBe(grouped.length);
    for (const queues of Object.values(PLAYER_PROFILE_QUEUE_PRESETS)) {
      expect(PlayerProfileQueueSelectionSchema.safeParse(queues).success).toBe(
        true,
      );
    }
  });
});
