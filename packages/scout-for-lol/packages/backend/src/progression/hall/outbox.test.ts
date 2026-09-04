import { describe, expect, test } from "vitest";
import { COMPETITIVE_PROGRESSION_CATALOG } from "@scout-for-lol/data";
import { hallBreakEmbed } from "#src/progression/hall/outbox.ts";

describe("Hall record-break embeds", () => {
  test("bounds tied holder names within Discord embed limits", () => {
    const queueFamily = COMPETITIVE_PROGRESSION_CATALOG.hall.queueFamilies[0];
    if (queueFamily === undefined) {
      throw new Error("Hall catalog requires a queue family");
    }
    const holder = {
      playerId: 1,
      playerAlias: "Long Hall Alias ".repeat(10),
      accountId: 1,
      accountAlias: "Main",
      puuid: "hall-test-puuid",
    };
    const payload = COMPETITIVE_PROGRESSION_CATALOG.hall.records.map(
      (record) => ({
        matchId: "NA1_HALL_TEST",
        gameEndAt: "2026-09-04T00:00:00.000Z",
        value: 12_345,
        holder,
        queueFamilyId: queueFamily.id,
        recordId: record.id,
        holders: Array.from({ length: 20 }, () => holder),
      }),
    );

    const json = hallBreakEmbed(
      JSON.stringify(payload),
      "NA1_HALL_TEST",
    ).toJSON();
    const fields = json.fields ?? [];
    const totalLength =
      (json.title?.length ?? 0) +
      (json.description?.length ?? 0) +
      fields.reduce(
        (total, field) => total + field.name.length + field.value.length,
        0,
      );

    expect(fields).toHaveLength(payload.length);
    expect(fields.every((field) => field.value.length <= 1024)).toBe(true);
    expect(totalLength).toBeLessThanOrEqual(5800);
  });
});
