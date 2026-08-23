import { describe, expect, test } from "vitest";
import { claimExploreRunFinished } from "#src/lib/explore-run-analytics.ts";

class MemoryStorage implements Storage {
  readonly #values = new Map<string, string>();

  get length(): number {
    return this.#values.size;
  }

  clear(): void {
    this.#values.clear();
  }

  getItem(key: string): string | null {
    return this.#values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.#values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.#values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.#values.set(key, value);
  }
}

describe("Explore completion analytics", () => {
  test("claims a run only once in shared storage", async () => {
    const storage = new MemoryStorage();

    await expect(claimExploreRunFinished("run-1", storage)).resolves.toBe(true);
    await expect(claimExploreRunFinished("run-1", storage)).resolves.toBe(
      false,
    );
  });

  test("retains only the newest completion claims", async () => {
    const storage = new MemoryStorage();
    for (let index = 0; index < 101; index += 1) {
      await claimExploreRunFinished(`run-${index.toString()}`, storage);
    }

    await expect(claimExploreRunFinished("run-0", storage)).resolves.toBe(true);
    await expect(claimExploreRunFinished("run-100", storage)).resolves.toBe(
      false,
    );
  });
});
