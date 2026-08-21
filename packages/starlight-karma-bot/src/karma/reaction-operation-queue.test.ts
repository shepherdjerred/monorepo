import { describe, expect, test } from "vitest";
import { ReactionOperationQueue } from "./reaction-operation-queue.ts";

describe("ReactionOperationQueue", () => {
  test("serializes add and remove work for the same message", async () => {
    const queue = new ReactionOperationQueue();
    const addStarted = Promise.withResolvers<undefined>();
    const finishAdd = Promise.withResolvers<undefined>();
    const events: string[] = [];

    const add = queue.run("message", async () => {
      events.push("add-started");
      addStarted.resolve(undefined);
      await finishAdd.promise;
      events.push("add-finished");
    });
    await addStarted.promise;

    const remove = queue.run("message", async () => {
      events.push("remove");
    });
    await Promise.resolve();
    expect(events).toEqual(["add-started"]);

    finishAdd.resolve(undefined);
    await Promise.all([add, remove]);
    expect(events).toEqual(["add-started", "add-finished", "remove"]);
  });

  test("does not block a different message", async () => {
    const queue = new ReactionOperationQueue();
    const finishFirst = Promise.withResolvers<undefined>();
    const secondFinished = Promise.withResolvers<undefined>();

    const first = queue.run("first-message", async () => {
      await finishFirst.promise;
    });
    const second = queue.run("second-message", async () => {
      secondFinished.resolve(undefined);
    });

    await secondFinished.promise;
    finishFirst.resolve(undefined);
    await Promise.all([first, second]);
  });

  test("continues the queue after an operation fails", async () => {
    const queue = new ReactionOperationQueue();

    await expect(
      queue.run("message", async () => {
        throw new Error("add failed");
      }),
    ).rejects.toThrow("add failed");

    const events: string[] = [];
    await queue.run("message", async () => {
      events.push("remove");
    });
    expect(events).toEqual(["remove"]);
  });
});
