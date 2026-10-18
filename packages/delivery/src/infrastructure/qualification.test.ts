import { describe, expect, test } from "vitest";
import { ciIdentity, createQualifier } from "./qualification.ts";

const build = {
  ciUrl: "https://woodpecker.sjer.red/repos/1/pipeline/42",
  sourceRevision: "a".repeat(40),
};
describe("exact CI qualification", () => {
  test("requires trusted origin, exact pipeline path and monorepo repository", () => {
    expect(ciIdentity(build.ciUrl, "https://woodpecker.sjer.red", 1)).toEqual({
      repositoryId: 1,
      pipelineNumber: 42,
    });
    expect(() =>
      ciIdentity(
        "https://evil.example.com/repos/1/pipeline/42",
        "https://woodpecker.sjer.red",
        1,
      ),
    ).toThrow();
    expect(() =>
      ciIdentity(
        "https://woodpecker.sjer.red/repos/2/pipeline/42",
        "https://woodpecker.sjer.red",
        1,
      ),
    ).toThrow();
  });
  test.each([
    ["running", 0, "pending"],
    ["success", 123, "verified"],
    ["success", 0, "failed"],
    ["failure", 123, "failed"],
    ["canceled", 123, "failed"],
  ] as const)(
    "CI %s finished=%s qualifies as %s",
    async (status, finished, expected) => {
      const qualify = createQualifier({
        origin: "https://woodpecker.sjer.red",
        repositoryId: 1,
        token: "test-only-credential",
        fetch: async () =>
          Response.json({
            number: 42,
            commit: build.sourceRevision,
            branch: "main",
            event: "push",
            status,
            finished,
          }),
      });
      expect(await qualify(build)).toBe(expected);
    },
  );
  test("a successful PR or different commit is not an eligible main build", async () => {
    const qualify = createQualifier({
      origin: "https://woodpecker.sjer.red",
      repositoryId: 1,
      token: "test-only-credential",
      fetch: async () =>
        Response.json({
          number: 42,
          commit: "b".repeat(40),
          branch: "main",
          event: "pull_request",
          status: "success",
          finished: 123,
        }),
    });
    await expect(qualify(build)).rejects.toMatchObject({ code: "INVALID" });
  });
  test("missing credentials and upstream failures fail closed", async () => {
    await expect(
      createQualifier({
        origin: "https://woodpecker.sjer.red",
        repositoryId: 1,
        token: undefined,
      })(build),
    ).rejects.toMatchObject({ code: "PAUSED" });
    await expect(
      createQualifier({
        origin: "https://woodpecker.sjer.red",
        repositoryId: 1,
        token: "test-only-credential",
        fetch: async () => new Response("denied", { status: 403 }),
      })(build),
    ).rejects.toMatchObject({ code: "PAUSED" });
  });
});
