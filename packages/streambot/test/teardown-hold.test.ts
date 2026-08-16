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
    let teardowns = 0;
    const hold = new TeardownHold(() => {
      teardowns += 1;
    });
    const release = hold.acquire();

    hold.request();
    expect(teardowns).toBe(0);
    release();
    release();
    expect(teardowns).toBe(1);
  });

  test("tears down immediately when no reply is active", () => {
    let teardowns = 0;
    const hold = new TeardownHold(() => {
      teardowns += 1;
    });
    hold.request();
    expect(teardowns).toBe(1);
  });

  test("a hold acquired after teardown fired does not replay the stale request", () => {
    let teardowns = 0;
    const hold = new TeardownHold(() => {
      teardowns += 1;
    });
    const release = hold.acquire();
    hold.request();
    release();
    expect(teardowns).toBe(1);

    const laterRelease = hold.acquire();
    laterRelease();
    expect(teardowns).toBe(1);
  });

  test("a fresh request after a fired teardown fires again", () => {
    let teardowns = 0;
    const hold = new TeardownHold(() => {
      teardowns += 1;
    });
    const release = hold.acquire();
    hold.request();
    release();
    expect(teardowns).toBe(1);

    const secondRelease = hold.acquire();
    hold.request();
    expect(teardowns).toBe(1);
    secondRelease();
    expect(teardowns).toBe(2);
  });

  test("drain resolves immediately when nothing holds the session", async () => {
    const hold = new TeardownHold(rejectTeardown);
    const drained = { value: false };
    await track(hold.drain(), drained);
    expect(drained.value).toBe(true);
  });

  test("drain waits for every outstanding hold before the voice disconnect", async () => {
    const hold = new TeardownHold(rejectTeardown);
    const releaseOne = hold.acquire();
    const releaseTwo = hold.acquire();
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
