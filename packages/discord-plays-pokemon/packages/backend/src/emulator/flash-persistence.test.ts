import { describe, expect, test } from "bun:test";
import { AtomicFlashPersistence } from "./flash-persistence.ts";

describe("AtomicFlashPersistence", () => {
  test("serializes writes so the latest queued image wins", async () => {
    const path = `${Bun.env.TMPDIR ?? "/tmp"}/pokemon-flash-${crypto.randomUUID()}.sav`;
    const persistence = new AtomicFlashPersistence();
    try {
      await Promise.all([
        persistence.enqueue(path, Uint8Array.from([1, 2, 3])),
        persistence.enqueue(path, Uint8Array.from([4, 5, 6])),
      ]);
      expect([...(await Bun.file(path).bytes())]).toEqual([4, 5, 6]);
    } finally {
      await Bun.file(path).delete();
    }
  });

  test("propagates an atomic write failure to the caller", async () => {
    const persistence = new AtomicFlashPersistence();

    await expect(
      persistence.enqueue("/dev/null/save.flash", Uint8Array.from([1])),
    ).rejects.toThrow();
  });
});
