import { describe, expect, test } from "vitest";
import { systemColorSchemeMediaQuery } from "./context.tsx";

describe("ScoutThemeProvider", () => {
  test("does not require matchMedia to initialize", () => {
    expect(systemColorSchemeMediaQuery(undefined)).toBeNull();
  });
});
