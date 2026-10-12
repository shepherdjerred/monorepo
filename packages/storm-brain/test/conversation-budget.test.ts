import { describe, expect, test } from "vitest";
import {
  ConversationBudget,
  maximumReplyMicroUsd,
} from "#src/conversation-budget.ts";
import {
  ConversationRequestSchema,
  ConversationResponseSchema,
} from "#src/conversation-schema.ts";

describe("companion conversation boundary", () => {
  test("accepts chat text and rejects action instructions in the wire response", () => {
    expect(
      ConversationResponseSchema.parse({
        text: "Hello!",
        model: "gpt-6-luna",
        costMicros: 10,
      }).text,
    ).toBe("Hello!");
    expect(
      ConversationResponseSchema.safeParse({
        text: "Hello!",
        model: "gpt-6-luna",
        costMicros: 10,
        action: "mine",
      }).success,
    ).toBe(false);
    expect(
      ConversationRequestSchema.safeParse({
        requestId: crypto.randomUUID(),
        identity: "rowan",
        personality: "Friendly",
        message: "a".repeat(1001),
        context: "",
      }).success,
    ).toBe(false);
  });
  test("reserves all attempts from catalog rates", () => {
    expect(
      maximumReplyMicroUsd("gpt-6-luna", "Hello", "Be friendly"),
    ).toBeGreaterThan(20_000);
    expect(() =>
      maximumReplyMicroUsd("unknown", "Hello", "Be friendly"),
    ).toThrow();
  });
  test("shares a durable cap between connections and preserves uncertain charges", async () => {
    const file = `/tmp/storm-conversation-${crypto.randomUUID()}.db`;
    const now = new Date("2026-10-01T02:00:00Z");
    const first = new ConversationBudget(file, 1000);
    const second = new ConversationBudget(file, 1000);
    try {
      first.reserve(now, "rowan", 600);
      expect(() => second.reserve(now, "juniper", 600)).toThrow(
        "budget exhausted",
      );
      first.settle("rowan", 200);
      second.reserve(now, "juniper", 600);
      expect(() => first.reserve(now, "flint", 300)).toThrow(
        "budget exhausted",
      );
      expect(() => first.reserve(now, "rowan", 1)).toThrow("already reserved");
    } finally {
      first.close();
      second.close();
    }
    const resumed = new ConversationBudget(file, 1000);
    try {
      expect(() => resumed.reserve(now, "restart", 300)).toThrow(
        "budget exhausted",
      );
      resumed.reserve(new Date("2026-10-01T07:00:00Z"), "next-month", 1000);
    } finally {
      resumed.close();
      for (const name of [file, `${file}-wal`, `${file}-shm`]) {
        const artifact = Bun.file(name);
        if (await artifact.exists()) await artifact.delete();
      }
    }
  });
});
