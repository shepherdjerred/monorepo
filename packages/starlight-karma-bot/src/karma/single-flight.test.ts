import { describe, expect, test } from "vitest";
import { SingleFlight } from "./single-flight.ts";

describe("SingleFlight", () => {
  test("skips an overlapping pass and accepts the next pass", async () => {
    const singleFlight = new SingleFlight();
    const firstStarted = Promise.withResolvers<undefined>();
    const finishFirst = Promise.withResolvers<undefined>();
    const events: string[] = [];

    const first = singleFlight.run(async () => {
      events.push("first-started");
      firstStarted.resolve(undefined);
      await finishFirst.promise;
      events.push("first-finished");
    });
    await firstStarted.promise;

    const overlappingStarted = await singleFlight.run(async () => {
      events.push("overlap");
    });
    expect(overlappingStarted).toBe(false);
    expect(events).toEqual(["first-started"]);

    finishFirst.resolve(undefined);
    expect(await first).toBe(true);

    const nextStarted = await singleFlight.run(async () => {
      events.push("next");
    });
    expect(nextStarted).toBe(true);
    expect(events).toEqual(["first-started", "first-finished", "next"]);
  });

  test("releases the gate when a pass fails", async () => {
    const singleFlight = new SingleFlight();
    await expect(
      singleFlight.run(async () => {
        throw new Error("pass failed");
      }),
    ).rejects.toThrow("pass failed");

    expect(await singleFlight.run(() => Promise.resolve())).toBe(true);
  });
});
