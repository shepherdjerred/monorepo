import { describe, expect, test } from "vitest";
import {
  guildIdFromAppPath,
  isExplorePath,
  resolveAppShellMode,
  shouldRenderGlobalFooter,
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

  test("identifies explore paths for scoped sidebar and footer rendering", () => {
    expect(isExplorePath("/explore")).toBe(true);
    expect(isExplorePath("/explore/abc-123")).toBe(true);
    expect(isExplorePath("/explore/s/share-token")).toBe(true);
    expect(isExplorePath("/app/explore")).toBe(true);

    expect(isExplorePath("/")).toBe(false);
    expect(isExplorePath("/players")).toBe(false);
    expect(isExplorePath("/bucks")).toBe(false);
    expect(isExplorePath("/manage")).toBe(false);
    expect(isExplorePath("/g/123/reports")).toBe(false);
  });

  test("omits global footer for explore routes while rendering for other pages", () => {
    expect(shouldRenderGlobalFooter("/explore")).toBe(false);
    expect(shouldRenderGlobalFooter("/explore/abc-123")).toBe(false);
    expect(shouldRenderGlobalFooter("/explore/s/share-token")).toBe(false);
    expect(shouldRenderGlobalFooter("/app/explore")).toBe(false);

    expect(shouldRenderGlobalFooter("/")).toBe(true);
    expect(shouldRenderGlobalFooter("/players")).toBe(true);
    expect(shouldRenderGlobalFooter("/bucks")).toBe(true);
    expect(shouldRenderGlobalFooter("/manage")).toBe(true);
    expect(shouldRenderGlobalFooter("/g/123/reports")).toBe(true);
  });
});
