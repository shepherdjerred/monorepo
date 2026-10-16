import { describe, expect, test } from "vitest";
import { APP_ROOT } from "./resources/arcade.ts";

// The manifests mount config/saves/etc. into the image's working directory, so
// APP_ROOT must equal the final WORKDIR of the deployed game image. The legacy
// game controllers are retired; their runtimes now live inside the Arcade image.

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
  test("Arcade", async () => {
    expect(APP_ROOT).toBe(await finalWorkdir("packages/arcade/Dockerfile"));
  });
});
