import { describe, expect, it } from "vitest";
import {
  boundedText,
  problemsOf,
  resolveEnvironment,
  resolveService,
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
