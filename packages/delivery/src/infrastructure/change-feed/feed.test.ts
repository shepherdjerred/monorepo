import { describe, expect, it } from "vitest";
import { createFanout, parseNotification } from "./feed.ts";
import { createChangeListener } from "./listener.ts";

describe("change feed", () => {
  it("parses audit notifications into domain events", () => {
    expect(
      parseNotification(
        JSON.stringify({
          id: "audit-1",
          action: "deployment.stage",
          entityId: "deployment-1",
        }),
      ),
    ).toEqual({
      id: "audit-1",
      action: "deployment.stage",
      entityId: "deployment-1",
      domain: "deployment",
    });
  });

  it("rejects an unknown audit domain", () => {
    expect(() =>
      parseNotification(
        JSON.stringify({ id: "a", action: "mystery.event", entityId: "x" }),
      ),
    ).toThrow();
  });

  it("fans messages out to current subscribers only", () => {
    const fanout = createFanout();
    const received: string[] = [];
    const unsubscribe = fanout.subscribe((message) =>
      received.push(message.type),
    );
    fanout.publish({ type: "resync" });
    unsubscribe();
    fanout.publish({ type: "resync" });
    expect(received).toEqual(["resync"]);
    expect(fanout.size()).toBe(0);
  });

  it("keeps retrying an unreachable database without failing startup", async () => {
    const feed = createChangeListener(
      "postgresql://smoke:smoke@127.0.0.1:1/delivery",
    );
    const started = feed.start();
    await Bun.sleep(100);
    await feed.stop();
    await expect(started).resolves.toBeUndefined();
  });
});
