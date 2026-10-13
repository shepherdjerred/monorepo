import { describe, expect, test } from "vitest";
import { authBootstrapFromEnv } from "#src/auth/bootstrap.ts";

const ORIGIN = "https://mariokart.example.com";

describe("authBootstrapFromEnv", () => {
  test("reads the origin and the client secret", () => {
    expect(
      authBootstrapFromEnv({
        WEB_PUBLIC_ORIGIN: ORIGIN,
        DISCORD_CLIENT_SECRET: "s",
      }),
    ).toEqual({ publicOrigin: ORIGIN, clientSecret: "s" });
  });

  test("names a missing setting", () => {
    expect(() => authBootstrapFromEnv({ DISCORD_CLIENT_SECRET: "s" })).toThrow(
      /WEB_PUBLIC_ORIGIN/u,
    );
    expect(() => authBootstrapFromEnv({ WEB_PUBLIC_ORIGIN: ORIGIN })).toThrow(
      /DISCORD_CLIENT_SECRET/u,
    );
  });

  test("takes a bare origin only", () => {
    expect(() =>
      authBootstrapFromEnv({
        WEB_PUBLIC_ORIGIN: `${ORIGIN}/`,
        DISCORD_CLIENT_SECRET: "s",
      }),
    ).toThrow(/not an origin/u);
  });
});
