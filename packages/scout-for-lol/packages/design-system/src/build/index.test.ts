import { describe, expect, test } from "vitest";
import { resolve } from "node:path";
import {
  decodeScoutAssetRequestUrl,
  resolveScoutAssetSource,
  scoutAssetStreamFailureAction,
} from "./index.ts";

describe("Scout asset request URLs", () => {
  test("rejects malformed percent encoding at the request boundary", () => {
    expect(decodeScoutAssetRequestUrl("/assets/scout/%ZZ.png")).toBeNull();
  });

  test("preserves valid encoded asset URLs", () => {
    expect(decodeScoutAssetRequestUrl("/assets/scout/Brand%20Mark.svg")).toBe(
      "/assets/scout/Brand Mark.svg",
    );
  });

  test("keeps resolved asset sources inside their declared root", () => {
    const root = "/srv/scout-assets";
    expect(resolveScoutAssetSource(root, "img/champion/Aatrox.png")).toBe(
      resolve(root, "img/champion/Aatrox.png"),
    );
    expect(resolveScoutAssetSource(root, "/etc/passwd")).toBeUndefined();
    expect(resolveScoutAssetSource(root, "../private.txt")).toBeUndefined();
    expect(resolveScoutAssetSource(root, "")).toBeUndefined();
  });

  test("ends unopened responses and destroys responses already in flight", () => {
    expect(scoutAssetStreamFailureAction(false)).toBe("not-found");
    expect(scoutAssetStreamFailureAction(true)).toBe("destroy");
  });
});
