import { matchRoutes } from "react-router";
import { afterEach, describe, expect, test, vi } from "vitest";
import { queryClient } from "#src/lib/query/query-client.ts";
import {
  loaderArgs,
  prefetchedKeys,
} from "#src/lib/routes/loader-test-support.ts";
import {
  consumerPlayerLoader,
  consumerPlayersLoader,
} from "#src/lib/routes/route-loaders.ts";
import { routes } from "#src/router.tsx";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("player loaders", () => {
  test("the Players loader only warms the roster, and never blocks", () => {
    const query = vi.spyOn(queryClient, "query").mockResolvedValue(undefined);
    expect(consumerPlayersLoader()).toBeNull();
    const keys = prefetchedKeys(query);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toContain("roster");
  });

  test("the Player loader warms the summary, the games and the rank history for the URL's filters", () => {
    const query = vi.spyOn(queryClient, "query").mockResolvedValue(undefined);
    const result = consumerPlayerLoader(
      loaderArgs("http://localhost/app/players/42?games=50&queue=solo", {
        playerId: "42",
      }),
    );
    expect(result).toBeNull();
    const keys = prefetchedKeys(query);
    expect(keys).toHaveLength(3);
    const summary = keys.find((key) => key.includes("profileSummary"));
    const history = keys.find((key) => key.includes("matchHistory"));
    const ranks = keys.find((key) => key.includes("rankHistory"));
    for (const key of [summary, history]) {
      expect(key).toContain('"playerId":42');
      expect(key).toContain('"games":50');
      expect(key).toContain('"queues":["solo"]');
    }
    expect(history).toContain('"limit":20');
    expect(ranks).toContain('"playerId":42');
  });

  test("a visit with no filters starts on the ranked queues and every game", () => {
    const query = vi.spyOn(queryClient, "query").mockResolvedValue(undefined);
    consumerPlayerLoader(
      loaderArgs("http://localhost/app/players/42", { playerId: "42" }),
    );
    const summary = prefetchedKeys(query).find((key) =>
      key.includes("profileSummary"),
    );
    expect(summary).toContain('"games":"all"');
    expect(summary).toContain('"queues":["solo","flex","ranked 5s","clash"]');
  });

  test("an id that is not a player warms nothing", () => {
    const query = vi.spyOn(queryClient, "query").mockResolvedValue(undefined);
    expect(
      consumerPlayerLoader(
        loaderArgs("http://localhost/app/players/nope", { playerId: "nope" }),
      ),
    ).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });
});

describe("player routes", () => {
  test("both pages are registered with their loaders", () => {
    const list = matchRoutes(routes, "/players")?.at(-1)?.route;
    const one = matchRoutes(routes, "/players/42")?.at(-1)?.route;
    expect(list?.loader).toBe(consumerPlayersLoader);
    expect(one?.loader).toBe(consumerPlayerLoader);
  });
});
