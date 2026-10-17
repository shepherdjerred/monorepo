import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { prepareGoalAuth } from "@discord-plays-pokemon/backend/goal/codex/codex-auth.ts";

const homes: string[] = [];
const syntheticId = `${Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url")}.${Buffer.from("{}").toString("base64url")}.c3ludGhldGlj`;
async function authDirectory() {
  const parent = await mkdtemp(path.join(tmpdir(), "arcade-goal-auth-test-"));
  homes.push(parent);
  return path.join(parent, ".codex-auth");
}
function authentication(access = "synthetic-access") {
  return JSON.stringify({
    auth_mode: "chatgpt",
    tokens: {
      access_token: access,
      refresh_token: "synthetic-refresh",
      account_id: "synthetic-account",
      id_token: syntheticId,
    },
    last_refresh: "2026-10-16T00:00:00Z",
  });
}
const encoded = (contents: string) => ({
  CODEX_AUTH_JSON_B64: Buffer.from(contents).toString("base64"),
});
afterEach(async () => {
  for (const home of homes.splice(0)) await rm(home, { recursive: true });
});

describe("Emerald subscription authentication", () => {
  it.each([undefined, "relative/auth"])(
    "requires an explicit absolute credential home: %s",
    async (home) => {
      await expect(
        prepareGoalAuth(encoded(authentication()), home),
      ).rejects.toThrow("Emerald goals require an absolute CODEX_HOME");
    },
  );
  it("rejects a mixed API-key cache without explicit subscription mode", async () => {
    const auth: unknown = JSON.parse(authentication());
    if (typeof auth !== "object" || auth === null)
      throw new Error("Invalid test fixture");
    const home = await authDirectory();
    await expect(
      prepareGoalAuth(
        encoded(
          JSON.stringify({
            ...auth,
            auth_mode: undefined,
            OPENAI_API_KEY: "synthetic-api-key",
          }),
        ),
        home,
      ),
    ).rejects.toThrow(/^Invalid Emerald subscription authentication$/u);
    await expect(
      prepareGoalAuth(
        encoded(JSON.stringify({ ...auth, auth_mode: "apikey" })),
        home,
      ),
    ).rejects.toThrow(/^Invalid Emerald subscription authentication$/u);
  });
  it("makes the complete refreshable cache available in an isolated private home", async () => {
    const contents = authentication();
    const home = await prepareGoalAuth(
      { ...encoded(contents), DISCORD_BOT_TOKEN: "unrelated-discord-secret" },
      await authDirectory(),
    );
    expect(await readFile(path.join(home, "auth.json"), "utf8")).toBe(contents);
    const directory = await stat(home);
    const file = await stat(path.join(home, "auth.json"));
    expect(directory.mode & 0o777).toBe(0o700);
    expect(file.mode & 0o777).toBe(0o600);
  });

  it("preserves CLI refresh across restarts and replaces credentials when the vault seed changes", async () => {
    const db = await authDirectory();
    const seed = encoded(authentication());
    const home = await prepareGoalAuth(seed, db);
    const refreshed = authentication("synthetic-refreshed-access");
    await writeFile(path.join(home, "auth.json"), refreshed);
    expect(await prepareGoalAuth(seed, db)).toBe(home);
    expect(await readFile(path.join(home, "auth.json"), "utf8")).toBe(
      refreshed,
    );
    const rotated = authentication("synthetic-rotated-access");
    await prepareGoalAuth(encoded(rotated), db);
    expect(await readFile(path.join(home, "auth.json"), "utf8")).toBe(rotated);
    await writeFile(path.join(home, "auth.json"), "synthetic-corrupt-secret");
    await expect(prepareGoalAuth(encoded(rotated), db)).rejects.toThrow(
      /^Invalid Emerald subscription authentication$/u,
    );
  });

  it("rejects missing, malformed, and incomplete credentials without exposing them", async () => {
    const db = await authDirectory();
    await expect(prepareGoalAuth({}, db)).rejects.toThrow(
      "Emerald goals require CODEX_AUTH_JSON_B64",
    );
    for (const contents of [
      "synthetic-private-non-json",
      JSON.stringify({ tokens: { access_token: "synthetic-private-access" } }),
    ]) {
      await expect(prepareGoalAuth(encoded(contents), db)).rejects.toThrow(
        /^Invalid Emerald subscription authentication$/u,
      );
    }
  });

  it.each([
    {
      tokens: {
        access_token: "synthetic-access",
        refresh_token: "synthetic-refresh",
        account_id: "synthetic-account",
      },
      last_refresh: "2026-10-16T00:00:00Z",
    },
    {
      tokens: {
        access_token: "synthetic-access",
        refresh_token: "synthetic-refresh",
        account_id: "synthetic-account",
        id_token: syntheticId,
      },
    },
    {
      tokens: {
        access_token: "synthetic-access",
        refresh_token: "synthetic-refresh",
        account_id: "synthetic-account",
        id_token: syntheticId,
      },
      last_refresh: "not-a-timestamp",
    },
  ])(
    "rejects a CLI-incompatible vault seed and persisted cache: %j",
    async (invalid) => {
      const db = await authDirectory();
      const contents = JSON.stringify(invalid);
      await expect(prepareGoalAuth(encoded(contents), db)).rejects.toThrow(
        /^Invalid Emerald subscription authentication$/u,
      );
      const seed = encoded(authentication());
      const home = await prepareGoalAuth(seed, db);
      await writeFile(path.join(home, "auth.json"), contents);
      await expect(prepareGoalAuth(seed, db)).rejects.toThrow(
        /^Invalid Emerald subscription authentication$/u,
      );
    },
  );
});
