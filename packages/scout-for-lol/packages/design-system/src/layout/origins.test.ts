import { describe, expect, test } from "bun:test";
import { surfaceHref } from "./origins.ts";

describe("surfaceHref", () => {
  test("keeps same-origin paths when no origin is configured", () => {
    expect(surfaceHref(undefined, "/docs/")).toBe("/docs/");
  });

  test("joins a configured origin without a double slash", () => {
    expect(surfaceHref("http://localhost:4325/", "/docs/")).toBe(
      "http://localhost:4325/docs/",
    );
  });
});
