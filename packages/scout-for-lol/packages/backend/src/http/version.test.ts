import { afterEach, describe, expect, test } from "bun:test";
import { resetConfigurationForTests } from "#src/configuration.ts";
import { handleVersion, versionBody } from "#src/http/version.ts";

function setBuildEnv(values: {
  VERSION: string;
  GIT_SHA: string;
  CONTRACT_HASH: string;
}): void {
  Bun.env["VERSION"] = values.VERSION;
  Bun.env["GIT_SHA"] = values.GIT_SHA;
  Bun.env["CONTRACT_HASH"] = values.CONTRACT_HASH;
  resetConfigurationForTests();
}

afterEach(() => {
  delete Bun.env["VERSION"];
  delete Bun.env["GIT_SHA"];
  delete Bun.env["CONTRACT_HASH"];
  resetConfigurationForTests();
});

describe("versionBody", () => {
  test("returns the baked build identity", () => {
    setBuildEnv({
      VERSION: "2.0.0-1234",
      GIT_SHA: "abcdef1234567890",
      CONTRACT_HASH: "cafebabe",
    });
    expect(versionBody()).toEqual({
      version: "2.0.0-1234",
      gitSha: "abcdef1234567890",
      contractHash: "cafebabe",
    });
  });
});

describe("handleVersion", () => {
  test("serves JSON with no-store and the provided CORS headers", async () => {
    setBuildEnv({
      VERSION: "2.0.0-1234",
      GIT_SHA: "abcdef1234567890",
      CONTRACT_HASH: "cafebabe",
    });
    const response = handleVersion({
      "Access-Control-Allow-Origin": "https://scout-for-lol.com",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://scout-for-lol.com",
    );
    expect(await response.json()).toEqual({
      version: "2.0.0-1234",
      gitSha: "abcdef1234567890",
      contractHash: "cafebabe",
    });
  });
});
