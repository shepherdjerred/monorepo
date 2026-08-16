import { describe, expect, test } from "bun:test";
import { systemColorSchemeMediaQuery } from "./context.tsx";

describe("ScoutThemeProvider", () => {
  test("does not require matchMedia to initialize", () => {
    expect(systemColorSchemeMediaQuery(undefined)).toBeNull();
  });
});
