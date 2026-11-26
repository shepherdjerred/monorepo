import { describe, expect, test } from "vitest";
import { createGameFactStore, isAbortError } from "./game-fact-store.ts";
import type {
  GameFact,
  GameFactKind,
  GameFactLoader,
} from "./game-fact-types.ts";

const charm: GameFact = {
  kind: "ability",
  patch: "16.23.1",
  key: "Ahri-E",
  name: "Charm",
  description: "Ahri blows a kiss that Charms the first enemy hit.",
  facts: [],
  parts: [],
  icon: "img/ability/Ahri-E.png",
  slot: "E",
  championKey: "Ahri",
  championName: "Ahri",
  maxRank: 5,
  cooldownByRank: [12, 12, 12, 12, 12],
  costByRank: [60, 60, 60, 60, 60],
  costType: "Mana",
  rangeByRank: [975, 975, 975, 975, 975],
  keyFact: { label: "Cooldown", value: "12 s" },
};

type Pending = {
  kind: GameFactKind;
  key: string;
  signal: AbortSignal;
  resolve: (fact: GameFact) => void;
  reject: (error: unknown) => void;
};

function pendingLoader(): { loader: GameFactLoader; calls: Pending[] } {
  const calls: Pending[] = [];
  const loader: GameFactLoader = (kind, key, { signal }) =>
    new Promise<GameFact>((resolve, reject) => {
      calls.push({ kind, key, signal, resolve, reject });
      signal.addEventListener("abort", () => {
        reject(new DOMException("aborted", "AbortError"));
      });
    });
  return { loader, calls };
}

describe("game fact store", () => {
  test("caches a finished load and serves it without another request", async () => {
    const { loader, calls } = pendingLoader();
    const store = createGameFactStore(loader);
    expect(store.peek("ability", "Ahri-E")).toBeUndefined();

    const first = store.load("ability", "Ahri-E");
    calls[0]?.resolve(charm);
    await expect(first.promise).resolves.toBe(charm);
    expect(store.peek("ability", "Ahri-E")).toBe(charm);

    await expect(store.load("ability", "Ahri-E").promise).resolves.toBe(charm);
    expect(calls).toHaveLength(1);
  });

  test("two holders share one request", () => {
    const { loader, calls } = pendingLoader();
    const store = createGameFactStore(loader);
    const first = store.load("ability", "Ahri-E");
    const second = store.load("ability", "Ahri-E");
    expect(calls).toHaveLength(1);
    expect(second.promise).toBe(first.promise);
  });

  test("aborts only when the last holder lets go", () => {
    const { loader, calls } = pendingLoader();
    const store = createGameFactStore(loader);
    const first = store.load("ability", "Ahri-E");
    const second = store.load("ability", "Ahri-E");
    first.release();
    expect(calls[0]?.signal.aborted).toBe(false);
    second.release();
    expect(calls[0]?.signal.aborted).toBe(true);
  });

  test("an aborted load rejects as an abort and is retried afterwards", async () => {
    const { loader, calls } = pendingLoader();
    const store = createGameFactStore(loader);
    const handle = store.load("ability", "Ahri-E");
    handle.release();
    await expect(handle.promise).rejects.toSatisfy(isAbortError);

    store.load("ability", "Ahri-E");
    expect(calls).toHaveLength(2);
  });

  test("a failed load is not remembered", async () => {
    const { loader, calls } = pendingLoader();
    const store = createGameFactStore(loader);
    const failed = store.load("ability", "Ahri-E");
    calls[0]?.reject(new Error("HTTP 404"));
    await expect(failed.promise).rejects.toThrow("HTTP 404");

    const retry = store.load("ability", "Ahri-E");
    calls[1]?.resolve(charm);
    await expect(retry.promise).resolves.toBe(charm);
  });
});
