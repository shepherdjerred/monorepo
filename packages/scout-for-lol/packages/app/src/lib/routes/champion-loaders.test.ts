import { RouterContextProvider, type LoaderFunctionArgs } from "react-router";
import { afterEach, describe, expect, test, vi } from "vitest";
import { queryClient } from "#src/lib/query/query-client.ts";
import {
  consumerChampionLoader,
  consumerChampionsLoader,
} from "#src/lib/routes/route-loaders.ts";

function loaderArgs(
  url: string,
  params: Record<string, string>,
): LoaderFunctionArgs {
  return {
    request: new Request(url),
    url: new URL(url),
    pattern: "/champions",
    params,
    context: new RouterContextProvider(),
  };
}

function prefetchedKeys(spy: { mock: { calls: unknown[][] } }): string[] {
  return spy.mock.calls.map((call) => JSON.stringify(call[0]));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("champion loaders", () => {
  test("the index loader only warms the index for the filters in the URL", () => {
    const query = vi.spyOn(queryClient, "query").mockResolvedValue(undefined);
    const result = consumerChampionsLoader(
      loaderArgs("http://localhost/app/champions?games=20", {}),
    );
    expect(result).toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
    const [key] = prefetchedKeys(query);
    expect(key).toContain("consumerChampion");
    expect(key).toContain('"games":20');
  });

  test("the champion loader warms both cohorts and the index, and never blocks", () => {
    const query = vi.spyOn(queryClient, "query").mockResolvedValue(undefined);
    const result = consumerChampionLoader(
      loaderArgs("http://localhost/app/champions/103", { championId: "103" }),
    );
    expect(result).toBeNull();
    const keys = prefetchedKeys(query);
    expect(keys).toHaveLength(3);
    expect(
      keys.filter((key) => key.includes('"cohort":"qualified"')),
    ).toHaveLength(1);
    expect(
      keys.filter((key) => key.includes('"cohort":"small_sample"')),
    ).toHaveLength(1);
    expect(keys.filter((key) => key.includes('"index"'))).toHaveLength(1);
    expect(
      keys.every(
        (key) =>
          key.includes('"games":"all"') || key.includes('"games": "all"'),
      ),
    ).toBe(true);
  });

  test("an id that is not a champion warms nothing", () => {
    const query = vi.spyOn(queryClient, "query").mockResolvedValue(undefined);
    expect(
      consumerChampionLoader(
        loaderArgs("http://localhost/app/champions/nope", {
          championId: "nope",
        }),
      ),
    ).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });
});
