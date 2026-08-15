import { describe, expect, test } from "bun:test";
import { TeardownHold } from "@shepherdjerred/streambot/session/teardown-hold.ts";

async function track(
  draining: Promise<void>,
  marker: { value: boolean },
): Promise<void> {
  await draining;
  marker.value = true;
}

function rejectTeardown(): never {
  throw new Error("teardown must not run while a hold is outstanding");
}

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

  test("drain resolves immediately when nothing holds the session", async () => {
    const hold = new TeardownHold();
    const drained = { value: false };
    await track(hold.drain(), drained);
    expect(drained.value).toBe(true);
  });

  test("drain waits for every outstanding hold before the voice disconnect", async () => {
    const hold = new TeardownHold();
    const releaseOne = hold.acquire(rejectTeardown);
    const releaseTwo = hold.acquire(rejectTeardown);
    const drained = { value: false };
    const draining = track(hold.drain(), drained);

    releaseOne();
    await Bun.sleep(0);
    expect(drained.value).toBe(false);
    releaseTwo();
    await draining;
    expect(drained.value).toBe(true);
  });
});
