import { describe, expect, test } from "vitest";
import {
  guildIdFromAppPath,
  isExplorePath,
  resolveAppShellMode,
  shouldRenderGlobalFooter,
} from "#src/lib/routes/app-navigation.ts";
import { buildInfo, deployedIdentity } from "#src/lib/build-info.ts";

describe("RootLayout footer release line", () => {
  test("omits the line until the backend version has loaded", () => {
    expect(deployedIdentity(undefined)).toBeUndefined();
  });

  test("names the deployed backend's version and commit", () => {
    expect(
      deployedIdentity({
        version: "2.0.0-6017",
        gitSha: "24e5a5ebe4302e6dc99efc1c3706e7541d9b33dc",
        contractHash: "cafebabe",
        canViewContractMismatch: false,
      }),
    ).toEqual({
      release: "2.0.0-6017",
      commit: "24e5a5ebe4302e6dc99efc1c3706e7541d9b33dc",
    });
  });

  test("the bundle carries no baked version or commit to fall back on", () => {
    expect(buildInfo).not.toHaveProperty("version");
    expect(buildInfo).not.toHaveProperty("gitSha");
  });
});

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
    expect(guildIdFromAppPath("/g/123456789012345678/reports")).toBe(
      "123456789012345678",
    );
    expect(guildIdFromAppPath("/g/123/reports")).toBeUndefined();
    expect(guildIdFromAppPath("/halls/123")).toBeUndefined();
    expect(guildIdFromAppPath("/duels/123")).toBeUndefined();
    expect(guildIdFromAppPath("/halls")).toBeUndefined();
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
