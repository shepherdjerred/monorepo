import { describe, expect, test } from "vitest";
import {
  guildIdFromAppPath,
  resolveAppShellMode,
} from "#src/lib/app-navigation.ts";

describe("RootLayout shell selection", () => {
  test("uses the workspace shell for signed-in product routes", () => {
    for (const pathname of ["/", "/explore", "/manage", "/g/123/reports"]) {
      expect(resolveAppShellMode(pathname, true)).toBe("workspace");
    }
  });

  test("uses the focused shell for public and setup routes", () => {
    expect(resolveAppShellMode("/explore", false)).toBe("focused");
    for (const pathname of [
      "/login",
      "/welcome",
      "/installed",
      "/explore/s/share-token",
    ]) {
      expect(resolveAppShellMode(pathname, true)).toBe("focused");
    }
  });

  test("reads the selected guild from basename-relative router paths", () => {
    expect(guildIdFromAppPath("/g/123/reports")).toBe("123");
    expect(guildIdFromAppPath("/manage")).toBeUndefined();
  });
});
