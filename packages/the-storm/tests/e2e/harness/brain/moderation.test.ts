import { describe, expect, test } from "vitest";
import { moderate } from "./moderation.ts";

function request(submissionId: string) {
  return {
    version: 1,
    submissionId,
    authorId: "alice",
    authorName: "Alice",
    surface: "chat",
    audience: "global",
    text: "hello",
    context: "",
  };
}

describe("moderation fixture UUID boundary", () => {
  test.each([
    "00000000-0000-4000-8000-000000000000",
    "ffffffff-ffff-4fff-bfff-ffffffffffff",
  ])("accepts RFC version four: %s", (id) => {
    expect(moderate(request(id)).status).toBe(200);
  });

  test.each([
    "00000000-0000-4000-0000-000000000000",
    "ffffffff-ffff-4fff-ffff-ffffffffffff",
    "01234567-89ab-cdef-8123-456789abcdef",
  ])("rejects arbitrary UUID bits: %s", (id) => {
    expect(moderate(request(id)).status).toBe(400);
  });
});
