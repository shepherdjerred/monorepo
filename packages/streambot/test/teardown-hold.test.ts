import { describe, expect, test } from "bun:test";
import { TeardownHold } from "@shepherdjerred/streambot/session/teardown-hold.ts";

describe("TeardownHold", () => {
  test("defers teardown until the spoken reply releases its hold", () => {
    const hold = new TeardownHold();
    let teardowns = 0;
    const teardown = () => {
      teardowns += 1;
    };
    const release = hold.acquire(teardown);

    hold.request(teardown);
    expect(teardowns).toBe(0);
    release();
    release();
    expect(teardowns).toBe(1);
  });

  test("tears down immediately when no reply is active", () => {
    const hold = new TeardownHold();
    let tornDown = false;
    hold.request(() => {
      tornDown = true;
    });
    expect(tornDown).toBe(true);
  });
});
