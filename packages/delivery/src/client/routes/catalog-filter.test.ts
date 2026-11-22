import { describe, expect, it } from "vitest";
import {
  boundedText,
  plainChoices,
  problemsOf,
  resolveChoice,
  resolveEnvironment,
  resolveService,
  unknownFilters,
  type CatalogService,
} from "./catalog-filter.ts";
import { pagedOnly } from "./search-schemas.ts";

const SERVICES: CatalogService[] = [
  {
    id: "scout-for-lol",
    title: "Scout for LoL",
    environments: [
      { id: "scout-for-lol/beta", name: "beta" },
      { id: "scout-for-lol/prod", name: "prod" },
    ],
  },
  {
    id: "arcade",
    title: "Arcade",
    environments: [{ id: "arcade/prod", name: "prod" }],
  },
  {
    id: "arcade-client",
    title: "Arcade client",
    environments: [{ id: "arcade-client/prod", name: "prod" }],
  },
];

describe("resolveService", () => {
  it("accepts the id, the display name in any case, or one partial match", () => {
    for (const typed of [
      "scout-for-lol",
      "Scout for LoL",
      "scout for lol",
      "scout",
      "LoL",
    ])
      expect(resolveService(typed, SERVICES)).toEqual({
        id: "scout-for-lol",
        problem: null,
      });
  });

  it("prefers an exact match over a partial one", () => {
    expect(resolveService("arcade", SERVICES).id).toBe("arcade");
  });

  it("asks the reader to choose when a partial name matches several", () => {
    const resolved = resolveService("arc", SERVICES);
    expect(resolved.id).toBeUndefined();
    expect(resolved.problem).toBe(
      "“arc” matches 2 services: Arcade, Arcade client. Choose one from the list.",
    );
  });

  it("passes an unknown id through, so a retired service keeps its history", () => {
    expect(resolveService("retired-thing", SERVICES)).toEqual({
      id: "retired-thing",
      problem: null,
    });
  });

  it("never sends a name the server would refuse", () => {
    expect(resolveService("No such service", SERVICES)).toEqual({
      id: undefined,
      problem:
        "No service is named “No such service”. Choose one from the list.",
    });
    // Without the catalog, an id still filters and a name still cannot.
    expect(resolveService("arcade", []).id).toBe("arcade");
    expect(resolveService("Scout for LoL", []).problem).not.toBeNull();
  });

  it("leaves an empty filter alone", () => {
    expect(resolveService(undefined, SERVICES)).toEqual({
      id: undefined,
      problem: null,
    });
  });
});

describe("resolveEnvironment", () => {
  it("accepts an id, or a name within the chosen service", () => {
    expect(resolveEnvironment("Arcade/Prod", SERVICES, undefined).id).toBe(
      "arcade/prod",
    );
    expect(resolveEnvironment("beta", SERVICES, undefined).id).toBe(
      "scout-for-lol/beta",
    );
    expect(resolveEnvironment("prod", SERVICES, "arcade").id).toBe(
      "arcade/prod",
    );
  });

  it("asks which service when a name belongs to several", () => {
    expect(resolveEnvironment("prod", SERVICES, undefined).problem).toBe(
      "“prod” matches 3 environments: scout-for-lol/prod, arcade/prod, arcade-client/prod. Choose one from the list.",
    );
  });

  it("refuses a value that is not an environment id", () => {
    expect(resolveEnvironment("arcade prod", SERVICES, undefined).problem).toBe(
      "No environment is named “arcade prod”. Choose one from the list.",
    );
  });
});

describe("boundedText and problemsOf", () => {
  it("names a filter longer than the server reads", () => {
    const long = boundedText("x".repeat(101), "Action prefix", 100);
    expect(long.problem).toBe("Action prefix can be at most 100 characters.");
    expect(boundedText("deployment.", "Action prefix", 100).id).toBe(
      "deployment.",
    );
    expect(problemsOf([long, resolveService("arcade", SERVICES)])).toEqual([
      "Action prefix can be at most 100 characters.",
    ]);
  });
});

describe("resolveChoice", () => {
  const STATUSES = plainChoices(["queued", "awaiting_approval"]);

  it("accepts a listed value and ignores an absent one", () => {
    expect(resolveChoice("queued", STATUSES, "status")).toEqual({
      id: "queued",
      problem: null,
    });
    expect(resolveChoice(undefined, STATUSES, "status")).toEqual({
      id: undefined,
      problem: null,
    });
  });

  it("names the accepted values for one that is not listed", () => {
    const bogus = resolveChoice("bogus", STATUSES, "status");
    expect(bogus.id).toBeUndefined();
    expect(bogus.problem).toBe(
      "“bogus” is not a status. Choose one of queued, awaiting approval.",
    );
    expect(problemsOf([bogus, resolveService("arcade", SERVICES)])).toEqual([
      bogus.problem,
    ]);
  });

  it("matches the token the URL carries and names the words the control shows", () => {
    expect(resolveChoice("awaiting_approval", STATUSES, "status").id).toBe(
      "awaiting_approval",
    );
    // The words are not the token: a hand-typed label is not accepted.
    expect(
      resolveChoice("awaiting approval", STATUSES, "status").problem,
    ).toContain("is not a status");
    const only = resolveChoice(
      "bogus",
      [{ value: "only", label: "Problems only" }],
      "scope",
    );
    expect(only.problem).toBe(
      "“bogus” is not a scope. Choose one of Problems only.",
    );
  });
});

describe("unknownFilters", () => {
  const ACTIVITY = [
    { name: "problems", label: "Show" },
    { name: "within", label: "Time range" },
  ];

  it("names each search parameter the page has no filter for", () => {
    expect(
      unknownFilters({ status: "bogus", within: "day", cursor: "c" }, ACTIVITY),
    ).toEqual([
      {
        problem:
          "“status” is not a filter on this page. Choose one of Show, Time range.",
      },
    ]);
    expect(
      problemsOf(unknownFilters({ a: "1", b: "2" }, ACTIVITY)),
    ).toHaveLength(2);
  });

  it("accepts the page's own filters, the paging cursor and absent values", () => {
    expect(
      unknownFilters(
        { problems: "only", within: undefined, cursor: "c", status: undefined },
        ACTIVITY,
      ),
    ).toEqual([]);
  });
});

describe("plainChoices", () => {
  it("reads a token's underscores as spaces and keeps the token", () => {
    expect(plainChoices(["awaiting_approval", "queued"])).toEqual([
      { value: "awaiting_approval", label: "awaiting approval" },
      { value: "queued", label: "queued" },
    ]);
  });
});

describe("pagedOnly", () => {
  it("is true only when the cursor alone changed", () => {
    expect(pagedOnly({}, { cursor: "a" })).toBe(true);
    expect(pagedOnly({ service: "x", cursor: "a" }, { service: "x" })).toBe(
      true,
    );
    expect(pagedOnly({ cursor: "a" }, { cursor: "a" })).toBe(false);
    expect(pagedOnly({ cursor: "a" }, { service: "x" })).toBe(false);
    expect(pagedOnly({}, { service: "x" })).toBe(false);
  });
});
