import { describe, expect, test } from "vitest";
import {
  Loaded,
  type LoadedData,
  type LoadedError,
} from "@shepherdjerred/loaded/index.ts";

const boom = new Error("boom");
const splat = new Error("splat");

function errorAt(path: readonly string[], error: unknown): LoadedError {
  return { path, error };
}

describe("constructors", () => {
  test("idle is loading without a request in flight", () => {
    expect(Loaded.idle()).toEqual({ status: "loading", fetching: false });
  });

  test("loading is the first load", () => {
    expect(Loaded.loading()).toEqual({ status: "loading", fetching: true });
  });

  test("done carries data and nothing else", () => {
    expect(Loaded.done(7)).toEqual({
      status: "done",
      fetching: false,
      data: 7,
    });
  });

  test("refreshing is done with a request in flight", () => {
    expect(Loaded.refreshing(7)).toEqual({
      status: "done",
      fetching: true,
      data: 7,
    });
  });

  test("degraded carries data and a non-empty error list", () => {
    expect(Loaded.degraded(7, [errorAt([], boom)])).toEqual({
      status: "degraded",
      fetching: false,
      errors: [errorAt([], boom)],
      data: 7,
    });
  });

  test("failed records the path it was given", () => {
    expect(Loaded.failed(boom, ["user"])).toEqual({
      status: "error",
      fetching: false,
      errors: [errorAt(["user"], boom)],
    });
  });
});

describe("map", () => {
  test("transforms done", () => {
    expect(Loaded.map(Loaded.done(2), (value) => value * 3)).toEqual({
      status: "done",
      fetching: false,
      data: 6,
    });
  });

  test("preserves degraded errors and fetching", () => {
    const value = Loaded.map(
      Loaded.map(Loaded.degraded(2, [errorAt(["org"], boom)]), (n) => n),
      (n) => n * 3,
    );
    expect(value).toEqual({
      status: "degraded",
      fetching: false,
      errors: [errorAt(["org"], boom)],
      data: 6,
    });
  });

  test("leaves loading and error untouched", () => {
    expect(Loaded.map(Loaded.loading(), () => 1)).toEqual({
      status: "loading",
      fetching: true,
    });
    expect(Loaded.map(Loaded.failed(boom), () => 1)).toEqual({
      status: "error",
      fetching: false,
      errors: [errorAt([], boom)],
    });
  });

  test("lets a throwing transform propagate", () => {
    expect(() =>
      Loaded.map(Loaded.done(1), () => {
        throw boom;
      }),
    ).toThrow(boom);
  });
});

describe("flatMap", () => {
  test("returns the inner result for a clean outer value", () => {
    expect(Loaded.flatMap(Loaded.done(1), (n) => Loaded.done(n + 1))).toEqual({
      status: "done",
      fetching: false,
      data: 2,
    });
  });

  test("degrades a clean inner result with the outer errors", () => {
    const outer = Loaded.degraded(1, [errorAt(["user"], boom)]);
    expect(Loaded.flatMap(outer, (n) => Loaded.done(n + 1))).toEqual({
      status: "degraded",
      fetching: false,
      errors: [errorAt(["user"], boom)],
      data: 2,
    });
  });

  test("drops the outer errors when the inner result is loading", () => {
    const outer = Loaded.degraded(1, [errorAt(["user"], boom)]);
    expect(Loaded.flatMap(outer, () => Loaded.loading())).toEqual({
      status: "loading",
      fetching: true,
    });
  });

  test("combines both error lists when the inner result fails", () => {
    const outer = Loaded.degraded(1, [errorAt(["user"], boom)]);
    expect(Loaded.flatMap(outer, () => Loaded.failed(splat))).toEqual({
      status: "error",
      fetching: false,
      errors: [errorAt([], splat), errorAt(["user"], boom)],
    });
  });

  test("propagates fetching from either side", () => {
    expect(Loaded.flatMap(Loaded.refreshing(1), (n) => Loaded.done(n))).toEqual(
      { status: "done", fetching: true, data: 1 },
    );
  });

  test("short-circuits on an unavailable outer value", () => {
    expect(Loaded.flatMap(Loaded.failed(boom), () => Loaded.done(1))).toEqual({
      status: "error",
      fetching: false,
      errors: [errorAt([], boom)],
    });
  });
});

describe("all", () => {
  test("joins clean dependencies", () => {
    expect(
      Loaded.all({ user: Loaded.done("ada"), count: Loaded.done(2) }),
    ).toEqual({
      status: "done",
      fetching: false,
      data: { user: "ada", count: 2 },
    });
  });

  test("error beats loading", () => {
    expect(
      Loaded.all({ user: Loaded.loading(), org: Loaded.failed(boom) }),
    ).toEqual({
      status: "error",
      fetching: true,
      errors: [errorAt(["org"], boom)],
    });
  });

  test("a pending join drops a sibling's non-fatal errors", () => {
    expect(
      Loaded.all({
        user: Loaded.loading(),
        org: Loaded.degraded("acme", [errorAt([], boom)]),
      }),
    ).toEqual({ status: "loading", fetching: true });
  });

  test("a resolved join surfaces the non-fatal errors again", () => {
    expect(
      Loaded.all({
        user: Loaded.done("ada"),
        org: Loaded.degraded("acme", [errorAt([], boom)]),
      }),
    ).toEqual({
      status: "degraded",
      fetching: false,
      errors: [errorAt(["org"], boom)],
      data: { user: "ada", org: "acme" },
    });
  });

  test("collects fatal and non-fatal errors together", () => {
    expect(
      Loaded.all({
        user: Loaded.failed(splat),
        org: Loaded.degraded("acme", [errorAt([], boom)]),
      }),
    ).toEqual({
      status: "error",
      fetching: false,
      errors: [errorAt(["user"], splat), errorAt(["org"], boom)],
    });
  });

  test("is fetching when any dependency is", () => {
    expect(
      Loaded.all({ user: Loaded.done("ada"), org: Loaded.refreshing("acme") }),
    ).toEqual({
      status: "done",
      fetching: true,
      data: { user: "ada", org: "acme" },
    });
  });

  test("nested joins compose the error path", () => {
    const page = Loaded.all({
      page: Loaded.all({
        user: Loaded.done("ada"),
        org: Loaded.degraded("acme", [errorAt([], boom)]),
      }),
    });
    expect(page).toEqual({
      status: "degraded",
      fetching: false,
      errors: [errorAt(["page", "org"], boom)],
      data: { page: { user: "ada", org: "acme" } },
    });
  });

  test("an empty join is done", () => {
    expect(Loaded.all({})).toEqual({
      status: "done",
      fetching: false,
      data: {},
    });
  });
});

describe("allArray", () => {
  test("joins a homogeneous list in order", () => {
    expect(
      Loaded.allArray([Loaded.done(1), Loaded.done(2), Loaded.done(3)]),
    ).toEqual({ status: "done", fetching: false, data: [1, 2, 3] });
  });

  test("paths are the element index", () => {
    expect(Loaded.allArray([Loaded.done(1), Loaded.failed(boom)])).toEqual({
      status: "error",
      fetching: false,
      errors: [errorAt(["1"], boom)],
    });
  });

  test("an empty list is done", () => {
    expect(Loaded.allArray([])).toEqual({
      status: "done",
      fetching: false,
      data: [],
    });
  });
});

describe("fromQuery", () => {
  test("pending projects to loading", () => {
    expect(
      Loaded.fromQuery({ data: undefined, error: null, isFetching: true }),
    ).toEqual({ status: "loading", fetching: true });
  });

  test("failure without data projects to error", () => {
    expect(
      Loaded.fromQuery({ data: undefined, error: boom, isFetching: false }, [
        "user",
      ]),
    ).toEqual({
      status: "error",
      fetching: false,
      errors: [errorAt(["user"], boom)],
    });
  });

  test("data projects to done", () => {
    expect(
      Loaded.fromQuery({ data: "ada", error: null, isFetching: false }),
    ).toEqual({ status: "done", fetching: false, data: "ada" });
  });

  test("a background refetch keeps rendering the data", () => {
    expect(
      Loaded.fromQuery({ data: "ada", error: null, isFetching: true }),
    ).toEqual({ status: "done", fetching: true, data: "ada" });
  });

  test("a failed refetch with cached data projects to degraded", () => {
    expect(
      Loaded.fromQuery({ data: "ada", error: boom, isFetching: false }),
    ).toEqual({
      status: "degraded",
      fetching: false,
      errors: [errorAt([], boom)],
      data: "ada",
    });
  });

  test("a success value of undefined projects to loading", () => {
    // Documented limitation: data presence is the signal, so a query whose
    // value type legitimately includes `undefined` cannot be distinguished
    // from one that has not resolved.
    expect(
      Loaded.fromQuery({ data: undefined, error: null, isFetching: false }),
    ).toEqual({ status: "loading", fetching: false });
  });
});

describe("match", () => {
  test("routes each variant and reports the orthogonal axes", () => {
    const describeValue = (value: Loaded<string>): string =>
      Loaded.match(value, {
        loading: (meta) => `loading:${String(meta.fetching)}`,
        error: (errors) => `error:${String(errors.length)}`,
        available: (data, meta) => `${data}:${String(meta.errors.length)}`,
      });

    expect(describeValue(Loaded.idle())).toBe("loading:false");
    expect(describeValue(Loaded.failed(boom))).toBe("error:1");
    expect(describeValue(Loaded.done("ada"))).toBe("ada:0");
    expect(describeValue(Loaded.degraded("ada", [errorAt([], boom)]))).toBe(
      "ada:1",
    );
  });
});

describe("getOrElse", () => {
  test("returns data when available, including when degraded", () => {
    expect(Loaded.getOrElse(Loaded.done("ada"), "nobody")).toBe("ada");
    expect(
      Loaded.getOrElse(Loaded.degraded("ada", [errorAt([], boom)]), "nobody"),
    ).toBe("ada");
  });

  test("returns the fallback otherwise", () => {
    expect(Loaded.getOrElse(Loaded.loading(), "nobody")).toBe("nobody");
    expect(Loaded.getOrElse(Loaded.failed(boom), "nobody")).toBe("nobody");
  });

  test("accepts a fallback of a different type, for progressive rendering", () => {
    const absent: string | undefined = Loaded.getOrElse(
      Loaded.loading(),
      undefined,
    );
    const present: string | undefined = Loaded.getOrElse(
      Loaded.done("ada"),
      undefined,
    );
    expect(absent).toBeUndefined();
    expect(present).toBe("ada");
  });
});

/**
 * Compile-time guard. `LoadedData` once used `T[K] extends Loaded<infer U>`,
 * which widened `U` with `undefined` because the data-less `loading` and
 * `error` members take part in the union match. That forced a null check on
 * data `LoadingBlock` had already proven present. If it regresses, `takesUser`
 * stops accepting `data.user` and `typecheck` fails here rather than in every
 * consumer.
 */
describe("LoadedData", () => {
  test("unwraps to the data type without widening it", () => {
    type User = { readonly name: string };
    const takesUser = (user: User): string => user.name;

    const data: LoadedData<{ user: Loaded<User> }> = { user: { name: "ada" } };

    expect(takesUser(data.user)).toBe("ada");
  });

  test("unwraps a joined record the same way", () => {
    type User = { readonly name: string };
    const joined = Loaded.all({
      user: Loaded.done<User>({ name: "ada" }),
      count: Loaded.done(2),
    });
    const rendered = Loaded.match(joined, {
      loading: () => "loading",
      error: () => "error",
      available: (data) => `${data.user.name}:${String(data.count)}`,
    });
    expect(rendered).toBe("ada:2");
  });
});

describe("QueryData", () => {
  /**
   * Regression: `fromQuery` once took `QueryLike<T>` with `data: T | undefined`.
   * Against a discriminated-union result the per-member match settled on
   * `T = undefined`, so every consumer's data collapsed to `undefined` — caught
   * only when a real `UseQueryResult` reached it. The authoritative guard is a
   * consumer package's `typecheck`; this pins the projection itself.
   */
  test("projects data through a discriminated-union result", () => {
    type User = { readonly name: string };
    type Result =
      | { data: User; error: null; isFetching: boolean; status: "success" }
      | { data: undefined; error: null; isFetching: boolean; status: "pending" }
      | { data: undefined; error: Error; isFetching: boolean; status: "error" };

    const takesUser = (user: User): string => user.name;
    const result: Result = {
      data: { name: "ada" },
      error: null,
      isFetching: false,
      status: "success",
    };

    const rendered = Loaded.match(Loaded.fromQuery(result), {
      loading: () => "loading",
      error: () => "error",
      available: (data) => takesUser(data),
    });
    expect(rendered).toBe("ada");
  });
});
