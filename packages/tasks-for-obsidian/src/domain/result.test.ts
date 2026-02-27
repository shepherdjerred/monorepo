import { describe, expect, test } from "bun:test";

import { OK_VOID, err, flatMap, map, mapErr, ok, unwrapOr } from "./result";

describe("ok", () => {
  test("creates an Ok result with the given value", () => {
    const result = ok(42);
    expect(result).toEqual({ ok: true, value: 42 });
  });

  test("works with string values", () => {
    const result = ok("hello");
    expect(result.ok).toBe(true);
    expect(result.value).toBe("hello");
  });

  test("works with object values", () => {
    const obj = { name: "test" };
    const result = ok(obj);
    expect(result.value).toBe(obj);
  });

  test("works with null", () => {
    const result = ok(null);
    expect(result).toEqual({ ok: true, value: null });
  });

  test("works with undefined (via OK_VOID)", () => {
    // OK_VOID is the canonical way to create ok(undefined)
    expect(OK_VOID.ok).toBe(true);
    expect(OK_VOID.value).toBeUndefined();
  });
});

describe("err", () => {
  test("creates an Err result with the given error", () => {
    const result = err("something went wrong");
    expect(result).toEqual({ ok: false, error: "something went wrong" });
  });

  test("works with error objects", () => {
    const error = new Error("fail");
    const result = err(error);
    expect(result.ok).toBe(false);
    expect(result.error).toBe(error);
  });

  test("works with number error codes", () => {
    const result = err(404);
    expect(result).toEqual({ ok: false, error: 404 });
  });
});

describe("OK_VOID", () => {
  test("is an Ok result with undefined value", () => {
    expect(OK_VOID).toEqual({ ok: true, value: undefined });
  });

  test("has ok set to true", () => {
    expect(OK_VOID.ok).toBe(true);
  });
});

describe("unwrapOr", () => {
  test("returns value for Ok result", () => {
    expect(unwrapOr(ok(42), 0)).toBe(42);
  });

  test("returns fallback for Err result", () => {
    expect(unwrapOr(err("fail"), 0)).toBe(0);
  });

  test("returns fallback even when fallback is same as value type", () => {
    expect(unwrapOr(err("fail"), "default")).toBe("default");
  });

  test("returns value when Ok even if fallback differs", () => {
    expect(unwrapOr(ok("actual"), "fallback")).toBe("actual");
  });
});

describe("map", () => {
  test("transforms value of Ok result", () => {
    const result = map(ok(5), (n) => n * 2);
    expect(result).toEqual({ ok: true, value: 10 });
  });

  test("passes through Err result unchanged", () => {
    const original = err("fail");
    const result = map(original, (n: number) => n * 2);
    expect(result).toEqual({ ok: false, error: "fail" });
    expect(result).toBe(original);
  });

  test("can change the type of the value", () => {
    const result = map(ok(42), String);
    expect(result).toEqual({ ok: true, value: "42" });
  });
});

describe("mapErr", () => {
  test("transforms error of Err result", () => {
    const result = mapErr(err("fail"), (e) => `wrapped: ${e}`);
    expect(result).toEqual({ ok: false, error: "wrapped: fail" });
  });

  test("passes through Ok result unchanged", () => {
    const original = ok(42);
    const result = mapErr(original, (e: string) => `wrapped: ${e}`);
    expect(result).toEqual({ ok: true, value: 42 });
    expect(result).toBe(original);
  });

  test("can change the type of the error", () => {
    const result = mapErr(err("not_found"), () => 404);
    expect(result).toEqual({ ok: false, error: 404 });
  });
});

describe("flatMap", () => {
  test("chains Ok results", () => {
    const result = flatMap(ok(5), (n) => ok(n * 2));
    expect(result).toEqual({ ok: true, value: 10 });
  });

  test("short-circuits on initial Err", () => {
    const original = err("fail");
    const result = flatMap(original, (n: number) => ok(n * 2));
    expect(result).toBe(original);
  });

  test("propagates Err from the chained function", () => {
    const result = flatMap(ok(5), () => err("chained error"));
    expect(result).toEqual({ ok: false, error: "chained error" });
  });

  test("can chain multiple flatMaps", () => {
    const result = flatMap(
      flatMap(ok(2), (n) => ok(n + 3)),
      (n) => ok(n * 10),
    );
    expect(result).toEqual({ ok: true, value: 50 });
  });
});
