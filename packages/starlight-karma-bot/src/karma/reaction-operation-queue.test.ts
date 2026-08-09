import { describe, expect, test } from "bun:test";
import { ReactionOperationQueue } from "./reaction-operation-queue.ts";

describe("ReactionOperationQueue", () => {
  test("serializes add and remove work for the same reaction", async () => {
    const queue = new ReactionOperationQueue();
    const addStarted = Promise.withResolvers<undefined>();
    const finishAdd = Promise.withResolvers<undefined>();
    const events: string[] = [];

    const add = queue.run("giver:message", async () => {
      events.push("add-started");
      addStarted.resolve(undefined);
      await finishAdd.promise;
      events.push("add-finished");
    });
    await addStarted.promise;

    const remove = queue.run("giver:message", async () => {
      events.push("remove");
    });
    await Promise.resolve();
    expect(events).toEqual(["add-started"]);

    finishAdd.resolve(undefined);
    await Promise.all([add, remove]);
    expect(events).toEqual(["add-started", "add-finished", "remove"]);
  });

  test("does not block a different reaction", async () => {
    const queue = new ReactionOperationQueue();
    const finishFirst = Promise.withResolvers<undefined>();
    const secondFinished = Promise.withResolvers<undefined>();

    const first = queue.run("giver:first", async () => {
      await finishFirst.promise;
    });
    const second = queue.run("giver:second", async () => {
      secondFinished.resolve(undefined);
    });

    await secondFinished.promise;
    finishFirst.resolve(undefined);
    await Promise.all([first, second]);
  });

  test("continues the queue after an operation fails", async () => {
    const queue = new ReactionOperationQueue();

    await expect(
      queue.run("giver:message", async () => {
        throw new Error("add failed");
      }),
    ).rejects.toThrow("add failed");

    const events: string[] = [];
    await queue.run("giver:message", async () => {
      events.push("remove");
    });
    expect(events).toEqual(["remove"]);
  });
});
