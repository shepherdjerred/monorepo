import { expect, test } from "bun:test";
import { unresolvedSecrets } from "./migration-core.ts";

test("reports missing and unresolved 1Password values", () => {
  expect(
    unresolvedSecrets({
      DISCORD_TOKEN: "op://vault/token",
      DISCORD_CLIENT_SECRET: "secret",
      JWT_SIGNING_SECRET: "secret",
    }),
  ).toEqual(["DISCORD_TOKEN", "RIOT_API_KEY"]);
});
