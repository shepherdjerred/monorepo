import { describe, it, expect } from "bun:test";
import {
  resolveString,
  resolveNumber,
  resolveBoolean,
  resolveValue,
  resolveActionContext,
  dataModelEntriesToObject,
  mergeDataModel,
} from "../src/data-binding.js";

describe("resolveString", () => {
  it("returns literal string when no path", () => {
    const result = resolveString({ literalString: "Hello" }, {});
    expect(result).toBe("Hello");
  });

  it("resolves path from data model", () => {
    const result = resolveString({ path: "/greeting" }, { greeting: "Hi there" });
    expect(result).toBe("Hi there");
  });

  it("falls back to literal when path not found", () => {
    const result = resolveString(
      { path: "/missing", literalString: "default" },
      {}
    );
    expect(result).toBe("default");
  });

  it("resolves nested paths", () => {
    const dataModel = {
      user: {
        profile: {
          name: "John",
        },
      },
    };
    const result = resolveString({ path: "/user/profile/name" }, dataModel);
    expect(result).toBe("John");
  });

  it("returns empty string when nothing found", () => {
    const result = resolveString({ path: "/missing" }, {});
    expect(result).toBe("");
  });
});

describe("resolveNumber", () => {
  it("returns literal number", () => {
    const result = resolveNumber({ literalNumber: 42 }, {});
    expect(result).toBe(42);
  });

  it("resolves path to number", () => {
    const result = resolveNumber({ path: "/count" }, { count: 100 });
    expect(result).toBe(100);
  });

  it("returns 0 when not found", () => {
    const result = resolveNumber({ path: "/missing" }, {});
    expect(result).toBe(0);
  });
});

describe("resolveBoolean", () => {
  it("returns literal boolean", () => {
    const result = resolveBoolean({ literalBoolean: true }, {});
    expect(result).toBe(true);
  });

  it("resolves path to boolean", () => {
    const result = resolveBoolean({ path: "/enabled" }, { enabled: false });
    expect(result).toBe(false);
  });

  it("returns false when not found", () => {
    const result = resolveBoolean({ path: "/missing" }, {});
    expect(result).toBe(false);
  });
});

describe("resolveValue", () => {
  it("handles string values", () => {
    const result = resolveValue({ literalString: "test" }, {});
    expect(result).toBe("test");
  });

  it("handles number values", () => {
    const result = resolveValue({ literalNumber: 123 }, {});
    expect(result).toBe(123);
  });

  it("handles boolean values", () => {
    const result = resolveValue({ literalBoolean: true }, {});
    expect(result).toBe(true);
  });

  it("handles array values", () => {
    const result = resolveValue({ literalArray: ["a", "b", "c"] }, {});
    expect(result).toEqual(["a", "b", "c"]);
  });
});

describe("resolveActionContext", () => {
  it("returns empty object for undefined context", () => {
    const result = resolveActionContext(undefined, {});
    expect(result).toEqual({});
  });

  it("resolves context values", () => {
    const context = [
      { key: "name", value: { literalString: "test" } },
      { key: "count", value: { literalNumber: 5 } },
    ];
    const result = resolveActionContext(context, {});
    expect(result).toEqual({ name: "test", count: 5 });
  });

  it("resolves paths in context", () => {
    const context = [{ key: "userId", value: { path: "/user/id" } }];
    const dataModel = { user: { id: "abc123" } };
    const result = resolveActionContext(context, dataModel);
    expect(result).toEqual({ userId: "abc123" });
  });
});

describe("dataModelEntriesToObject", () => {
  it("converts string entries", () => {
    const entries = [{ key: "name", valueString: "John" }];
    const result = dataModelEntriesToObject(entries);
    expect(result).toEqual({ name: "John" });
  });

  it("converts number entries", () => {
    const entries = [{ key: "age", valueNumber: 25 }];
    const result = dataModelEntriesToObject(entries);
    expect(result).toEqual({ age: 25 });
  });

  it("converts boolean entries", () => {
    const entries = [{ key: "active", valueBoolean: true }];
    const result = dataModelEntriesToObject(entries);
    expect(result).toEqual({ active: true });
  });

  it("converts nested map entries", () => {
    const entries = [
      {
        key: "user",
        valueMap: [
          { key: "name", valueString: "John" },
          { key: "age", valueNumber: 25 },
        ],
      },
    ];
    const result = dataModelEntriesToObject(entries);
    expect(result).toEqual({
      user: { name: "John", age: 25 },
    });
  });
});

describe("mergeDataModel", () => {
  it("merges at root level", () => {
    const existing = { a: 1 };
    const update = [{ key: "b", valueNumber: 2 }];
    const result = mergeDataModel(existing, update);
    expect(result).toEqual({ a: 1, b: 2 });
  });

  it("overwrites existing keys", () => {
    const existing = { a: 1 };
    const update = [{ key: "a", valueNumber: 2 }];
    const result = mergeDataModel(existing, update);
    expect(result).toEqual({ a: 2 });
  });

  it("merges at specific path", () => {
    const existing = { user: { name: "John" } };
    const update = [{ key: "age", valueNumber: 25 }];
    const result = mergeDataModel(existing, update, "/user");
    expect(result["user"]).toEqual({ age: 25 });
  });
});
