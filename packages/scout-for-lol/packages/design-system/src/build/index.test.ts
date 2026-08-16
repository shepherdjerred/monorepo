import { describe, expect, test } from "bun:test";
import { decodeScoutAssetRequestUrl } from "./index.ts";

describe("Scout asset request URLs", () => {
  test("rejects malformed percent encoding at the request boundary", () => {
    expect(decodeScoutAssetRequestUrl("/assets/scout/%ZZ.png")).toBeNull();
  });

  test("preserves valid encoded asset URLs", () => {
    expect(decodeScoutAssetRequestUrl("/assets/scout/Brand%20Mark.svg")).toBe(
      "/assets/scout/Brand Mark.svg",
    );
  });
});
