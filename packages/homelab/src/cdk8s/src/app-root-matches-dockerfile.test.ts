import { describe, expect, test } from "bun:test";
import { APP_ROOT as POKEMON_APP_ROOT } from "./resources/pokemon.ts";
import { APP_ROOT as MARIO_KART_APP_ROOT } from "./resources/mario-kart.ts";

// The manifests mount config/saves/etc. into the image's working directory, so
// each APP_ROOT constant must equal the final WORKDIR of the image it deploys.
// This drifted silently in #1517 (images moved /workspace → /app while the
// manifests kept /workspace) and took pokemon + mario-kart down; this test
// turns that drift into a CI failure.

// Repo root: this file lives at packages/homelab/src/cdk8s/src/.
const repoRoot = new URL("../../../../../", import.meta.url).pathname;

async function finalWorkdir(dockerfileRepoPath: string): Promise<string> {
  const text = await Bun.file(`${repoRoot}${dockerfileRepoPath}`).text();
  const workdirs = text
    .split("\n")
    .map((line) => /^WORKDIR\s+(\S+)\s*$/.exec(line.trim()))
    .filter((match) => match !== null)
    .map((match) => match[1]);
  const last = workdirs.at(-1);
  if (last === undefined) {
    throw new Error(`no WORKDIR found in ${dockerfileRepoPath}`);
  }
  return last;
}

describe("APP_ROOT matches the image's final WORKDIR", () => {
  test("discord-plays-pokemon", async () => {
    expect(POKEMON_APP_ROOT).toBe(
      await finalWorkdir("packages/discord-plays-pokemon/Dockerfile"),
    );
  });

  test("discord-plays-mario-kart", async () => {
    expect(MARIO_KART_APP_ROOT).toBe(
      await finalWorkdir("packages/discord-plays-mario-kart/Dockerfile"),
    );
  });
});
