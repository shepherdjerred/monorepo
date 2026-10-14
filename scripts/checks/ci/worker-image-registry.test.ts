import { expect, test } from "vitest";
import {
  bakedGitSha,
  digestForCommitTag,
  imageGitSha,
} from "./worker-image-registry.ts";

const commit = "a".repeat(40);
const digest = `sha256:${"b".repeat(64)}`;
const image = { config: { Env: [`GIT_SHA=${commit}`] } };
test("reads single-platform and coherent multi-platform build identities", () => {
  expect(imageGitSha(image)).toBe(commit);
  expect(imageGitSha({ "linux/amd64": image, "linux/arm64": image })).toBe(
    commit,
  );
  expect(() =>
    imageGitSha({
      "linux/amd64": image,
      "linux/arm64": { config: { Env: [`GIT_SHA=${"c".repeat(40)}`] } },
    }),
  ).toThrow("one coherent GIT_SHA");
  expect(() => imageGitSha({})).toThrow();
  expect(() => imageGitSha({ config: { Env: [] } })).toThrow();
});

test("uses authenticated Docker inspection rather than an anonymous token exchange", async () => {
  expect(
    await bakedGitSha(
      "shepherdjerred/temporal-worker",
      digest,
      async (command) => {
        expect(command).toContain(
          `docker.io/shepherdjerred/temporal-worker@${digest}`,
        );
        return { exitCode: 0, stdout: JSON.stringify(image), stderr: "" };
      },
    ),
  ).toBe(commit);
});

test("missing historical commit tags are distinct from auth and transport failures", async () => {
  expect(
    await digestForCommitTag(
      "shepherdjerred/temporal-worker",
      commit,
      async () => ({ exitCode: 1, stdout: "", stderr: "manifest unknown" }),
    ),
  ).toBeUndefined();
  await expect(
    digestForCommitTag("shepherdjerred/temporal-worker", commit, async () => ({
      exitCode: 1,
      stdout: "",
      stderr: "unauthorized",
    })),
  ).rejects.toThrow("Could not inspect worker commit tag");
  expect(
    await digestForCommitTag(
      "shepherdjerred/temporal-worker",
      commit,
      async () => ({
        exitCode: 0,
        stdout: JSON.stringify({ digest }),
        stderr: "",
      }),
    ),
  ).toBe(digest);
});
