import { afterEach, describe, expect, it } from "vitest";
import { readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { prepareGoalAuth } from "#src/goal-auth.ts";

const homes: string[] = [];
afterEach(async () => {
  for (const home of homes.splice(0)) await rm(home, { recursive: true });
});

describe("Emerald subscription authentication", () => {
  it("makes the complete refreshable cache available in an isolated private home", async () => {
    const contents = JSON.stringify({
      auth_mode: "chatgpt",
      tokens: {
        access_token: "synthetic-access",
        refresh_token: "synthetic-refresh",
        account_id: "synthetic-account",
        id_token: "synthetic-id",
      },
      last_refresh: "2026-10-16T00:00:00Z",
    });
    const home = await prepareGoalAuth({
      CODEX_AUTH_JSON_B64: Buffer.from(contents).toString("base64"),
      DISCORD_BOT_TOKEN: "unrelated-discord-secret",
    });
    homes.push(home);
    expect(await readFile(path.join(home, "auth.json"), "utf8")).toBe(contents);
    const directory = await stat(home);
    const file = await stat(path.join(home, "auth.json"));
    expect(directory.mode & 0o777).toBe(0o700);
    expect(file.mode & 0o777).toBe(0o600);
  });

  it("rejects missing, malformed, and incomplete credentials without exposing them", async () => {
    await expect(prepareGoalAuth({})).rejects.toThrow(
      "Emerald goals require CODEX_AUTH_JSON_B64",
    );
    for (const contents of [
      "synthetic-private-non-json",
      JSON.stringify({ tokens: { access_token: "synthetic-private-access" } }),
    ]) {
      await expect(
        prepareGoalAuth({
          CODEX_AUTH_JSON_B64: Buffer.from(contents).toString("base64"),
        }),
      ).rejects.toThrow(/^Invalid Emerald subscription authentication$/u);
    }
  });
});
