import { describe, expect, test } from "vitest";
import {
  GAME_FACT_ROOT,
  GameFactLoadError,
  type GameFactFetcher,
  loadGameFact,
} from "#src/game-facts/client.ts";
import { GameFactSchema } from "#src/game-facts/schema.ts";

const charm = GameFactSchema.parse(
  await Bun.file(
    `${import.meta.dirname}/../data-dragon/assets/facts/ability/Ahri-E.json`,
  ).json(),
);

function stubFetch(respond: (url: string) => Response): {
  fetcher: GameFactFetcher;
  urls: string[];
  signals: unknown[];
} {
  const urls: string[] = [];
  const signals: unknown[] = [];
  const fetcher: GameFactFetcher = (url, init) => {
    urls.push(url);
    signals.push(init.signal);
    return Promise.resolve(respond(url));
  };
  return { fetcher, urls, signals };
}

describe("loadGameFact", () => {
  test("fetches the versioned fact file with the caller's signal", async () => {
    const stub = stubFetch(() => Response.json(charm));
    const controller = new AbortController();
    const fact = await loadGameFact("ability", "Ahri-E", {
      signal: controller.signal,
      fetcher: stub.fetcher,
    });
    expect(fact).toEqual(charm);
    expect(stub.urls).toEqual([`${GAME_FACT_ROOT}/facts/ability/Ahri-E.json`]);
    expect(GAME_FACT_ROOT).toMatch(/^\/assets\/scout\/game\/\d+\.\d+\.\d+$/);
    expect(stub.signals).toEqual([controller.signal]);
  });

  test("reports a missing file as a typed error", async () => {
    const stub = stubFetch(() => new Response("nope", { status: 404 }));
    const load = loadGameFact("item", "1", { fetcher: stub.fetcher });
    await expect(load).rejects.toBeInstanceOf(GameFactLoadError);
    await expect(load).rejects.toMatchObject({ status: 404 });
  });

  test("rejects a body that is not a game fact", async () => {
    const stub = stubFetch(() => Response.json({ kind: "item" }));
    await expect(
      loadGameFact("item", "1", { fetcher: stub.fetcher }),
    ).rejects.toThrow();
  });

  test("rejects a file that holds another entity", async () => {
    const stub = stubFetch(() => Response.json(charm));
    await expect(
      loadGameFact("ability", "Ahri-Q", { fetcher: stub.fetcher }),
    ).rejects.toThrow("holds ability/Ahri-E, expected ability/Ahri-Q");
  });

  test("uses a caller-supplied asset root", async () => {
    const stub = stubFetch(() => Response.json(charm));
    await loadGameFact("ability", "Ahri-E", {
      root: "/cdn/game/9.9.9",
      fetcher: stub.fetcher,
    });
    expect(stub.urls).toEqual(["/cdn/game/9.9.9/facts/ability/Ahri-E.json"]);
  });
});
