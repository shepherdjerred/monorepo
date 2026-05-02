import { describe, test, expect } from "bun:test";
import { withConversationLock } from "./conversation-lock.ts";

describe("withConversationLock", () => {
  test("serializes concurrent calls on the same conversation", async () => {
    const events: string[] = [];
    let resolveFirst!: () => void;
    const firstHold = new Promise<void>((r) => {
      resolveFirst = r;
    });

    const conv = "channel:111";
    const first = withConversationLock(conv, async () => {
      events.push("first:start");
      await firstHold;
      events.push("first:end");
      return 1;
    });
    const second = withConversationLock(conv, async () => {
      events.push("second:start");
      return 2;
    });

    // Yield enough microtasks for both invocations to register on the queue.
    await Promise.resolve();
    await Promise.resolve();

    // Second must NOT have run yet — first is still holding.
    expect(events).toEqual(["first:start"]);

    resolveFirst();
    expect(await first).toBe(1);
    expect(await second).toBe(2);
    expect(events).toEqual(["first:start", "first:end", "second:start"]);
  });

  test("does not serialize calls across different conversations", async () => {
    const order: string[] = [];
    let resolveA!: () => void;
    const aHold = new Promise<void>((r) => {
      resolveA = r;
    });

    const a = withConversationLock("conv:a", async () => {
      order.push("a:start");
      await aHold;
      order.push("a:end");
    });
    const b = withConversationLock("conv:b", async () => {
      order.push("b:start");
      order.push("b:end");
    });

    await b;
    expect(order).toEqual(["a:start", "b:start", "b:end"]);

    resolveA();
    await a;
    expect(order).toEqual(["a:start", "b:start", "b:end", "a:end"]);
  });

  test("a failing prior turn does not block subsequent turns", async () => {
    const conv = "channel:222";
    const failing = withConversationLock(conv, async () => {
      await Promise.resolve();
      throw new Error("boom");
    });
    const succeeding = withConversationLock(conv, async () => {
      return "ok";
    });

    await expect(failing).rejects.toThrow("boom");
    expect(await succeeding).toBe("ok");
  });
});
