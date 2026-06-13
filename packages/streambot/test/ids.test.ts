import { describe, expect, test } from "bun:test";
import {
  GuildIdSchema,
  toChannelId,
  toUserId,
} from "@shepherdjerred/streambot/types/ids.ts";

describe("branded ids", () => {
  test("accepts valid snowflakes", () => {
    expect(String(GuildIdSchema.parse("1337623164146155593"))).toBe(
      "1337623164146155593",
    );
    expect(String(toUserId("160509172704739328"))).toBe("160509172704739328");
    expect(String(toChannelId("1337631455085334650"))).toBe(
      "1337631455085334650",
    );
  });

  test("rejects non-snowflakes", () => {
    expect(() => toUserId("not-an-id")).toThrow();
    expect(() => toUserId("123")).toThrow();
    expect(GuildIdSchema.safeParse("abc").success).toBe(false);
  });
});
