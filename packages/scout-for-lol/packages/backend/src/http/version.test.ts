import { afterEach, describe, expect, test } from "bun:test";
import { resetConfigurationForTests } from "#src/configuration.ts";
import { ME } from "#src/configuration/flags.ts";
import { handleVersion, versionBody } from "#src/http/version.ts";
import { signSession } from "#src/trpc/jwt.ts";

function setBuildEnv(values: {
  VERSION: string;
  GIT_SHA: string;
  CONTRACT_HASH: string;
}): void {
  Bun.env["VERSION"] = values.VERSION;
  Bun.env["GIT_SHA"] = values.GIT_SHA;
  Bun.env["CONTRACT_HASH"] = values.CONTRACT_HASH;
  Bun.env["JWT_SIGNING_SECRET"] =
    "a-secure-test-signing-secret-that-is-long-enough";
  resetConfigurationForTests();
}

afterEach(() => {
  delete Bun.env["VERSION"];
  delete Bun.env["GIT_SHA"];
  delete Bun.env["CONTRACT_HASH"];
  delete Bun.env["JWT_SIGNING_SECRET"];
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
    const response = await handleVersion(
      new Request("https://scout-for-lol.com/api/version"),
      {
        "Access-Control-Allow-Origin": "https://scout-for-lol.com",
      },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://scout-for-lol.com",
    );
    expect(await response.json()).toEqual({
      version: "2.0.0-1234",
      gitSha: "abcdef1234567890",
      contractHash: "cafebabe",
      canViewContractMismatch: false,
    });
  });

  test("authorizes the contract diagnostic from the signed owner session", async () => {
    setBuildEnv({
      VERSION: "2.0.0-1234",
      GIT_SHA: "abcdef1234567890",
      CONTRACT_HASH: "cafebabe",
    });
    const { jwt } = await signSession({ discordId: ME });
    const response = await handleVersion(
      new Request("https://scout-for-lol.com/api/version", {
        headers: { Cookie: `scout_session=${jwt}` },
      }),
      {},
    );

    expect(await response.json()).toMatchObject({
      canViewContractMismatch: true,
    });
  });
});
