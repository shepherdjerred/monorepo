import {
  matchRoutes,
  RouterContextProvider,
  type LoaderFunctionArgs,
} from "react-router";
import { afterEach, describe, expect, test, vi } from "vitest";
import { queryClient } from "#src/lib/query/query-client.ts";
import {
  consumerLiveGameLoader,
  consumerLiveLoader,
} from "#src/lib/routes/route-loaders.ts";
import { routes } from "#src/router.tsx";

function loaderArgs(
  url: string,
  params: Record<string, string>,
): LoaderFunctionArgs {
  return {
    request: new Request(url),
    url: new URL(url),
    pattern: "/live",
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

describe("live loaders", () => {
  test("the list loader only warms the list, and never blocks", () => {
    const query = vi.spyOn(queryClient, "query").mockResolvedValue(undefined);
    expect(consumerLiveLoader()).toBeNull();
    const keys = prefetchedKeys(query);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toContain("consumerLive");
    expect(keys[0]).toContain("list");
  });

  test("the game loader warms the one game the URL names", () => {
    const query = vi.spyOn(queryClient, "query").mockResolvedValue(undefined);
    const result = consumerLiveGameLoader(
      loaderArgs("http://localhost/app/live/NA1_5500000777", {
        riotMatchId: "NA1_5500000777",
      }),
    );
    expect(result).toBeNull();
    const keys = prefetchedKeys(query);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toContain("consumerLive");
    expect(keys[0]).toContain('"riotMatchId":"NA1_5500000777"');
  });

  test("an id that is not a match warms nothing", () => {
    const query = vi.spyOn(queryClient, "query").mockResolvedValue(undefined);
    expect(
      consumerLiveGameLoader(
        loaderArgs("http://localhost/app/live/nope", { riotMatchId: "nope" }),
      ),
    ).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });
});

describe("live routes", () => {
  test("both pages are registered with their loaders", () => {
    const list = matchRoutes(routes, "/live")?.at(-1)?.route;
    const one = matchRoutes(routes, "/live/NA1_5500000777")?.at(-1)?.route;
    expect(list?.loader).toBe(consumerLiveLoader);
    expect(one?.loader).toBe(consumerLiveGameLoader);
  });
});
