import { afterEach, describe, expect, test, vi } from "vitest";
import {
  matchRoutes,
  RouterContextProvider,
  type LoaderFunctionArgs,
} from "react-router";
import { routes } from "#src/router.tsx";
import { queryClient } from "#src/lib/query/query-client.ts";
import { trpcOptions } from "#src/lib/query/trpc-options.ts";
import { PROTECTED_QUERY_OPTIONS } from "#src/lib/query/protected-query-options.ts";
import { consumerMatchLoader } from "#src/lib/routes/route-loaders.ts";

function args(params: Record<string, string>): LoaderFunctionArgs {
  const href = "https://scout.test/app/players/42/matches/NA1_1";
  return {
    params,
    request: new Request(href),
    url: new URL(href),
    pattern: "/players/:playerId/matches/:matchId",
    context: new RouterContextProvider(),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("consumerMatchLoader", () => {
  test("is the loader of the consumer match route", () => {
    const matches = matchRoutes(routes, "/players/42/matches/NA1_5000000001");
    expect(matches?.at(-1)?.route.loader).toBe(consumerMatchLoader);
  });

  test("preloads only the detail, on the key the page reads", () => {
    const query = vi.spyOn(queryClient, "query").mockResolvedValue(undefined);
    const result = consumerMatchLoader(
      args({ playerId: "42", matchId: "NA1_5000000001" }),
    );
    expect(result).toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
    const expected = trpcOptions.consumerMatch.detail.queryOptions(
      { playerId: 42, matchId: "NA1_5000000001" },
      PROTECTED_QUERY_OPTIONS,
    );
    const [options] = query.mock.calls[0] ?? [];
    expect(options?.queryKey).toEqual(expected.queryKey);
    expect(options?.gcTime).toBe(0);
    expect(options?.staleTime).toBe(0);
  });

  test("preloads nothing for params the route would reject", () => {
    const query = vi.spyOn(queryClient, "query").mockResolvedValue(undefined);
    expect(
      consumerMatchLoader(args({ playerId: "abc", matchId: "NA1_5000000001" })),
    ).toBeNull();
    expect(
      consumerMatchLoader(args({ playerId: "42", matchId: "not-a-match" })),
    ).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });
});
