import { describe, expect, test } from "bun:test";
import { appGlobalPath } from "./root-layout.tsx";

describe("RootLayout global navigation path", () => {
  test("restores the app basename for the dashboard route", () => {
    expect(appGlobalPath("/")).toBe("/app/");
  });

  test("restores the app basename for nested routes", () => {
    expect(appGlobalPath("/g/example/reports")).toBe("/app/g/example/reports");
  });
});
