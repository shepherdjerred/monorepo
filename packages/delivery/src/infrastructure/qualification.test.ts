import { describe, expect, test } from "vitest";
import { ciIdentity, createQualifier } from "./qualification.ts";
import type { SourceCommitReport } from "./hub/source-commit.ts";
import { testExecutor } from "#testing/seed.ts";

/** Who asked for a qualification, and in which request. */
const asked = { actor: testExecutor, requestId: "qualify-request" };
const build = {
  ciUrl: "https://woodpecker.sjer.red/repos/1/pipeline/42",
  sourceRevision: "a".repeat(40),
  buildId: "build-42",
  ...asked,
};
const MESSAGE = "feat(arcade): ship it (#42)\n\nWhy\n\nBecause.";

const unreachable = () => Promise.reject(new Error("must not record"));

/** A qualifier over one canned pipeline answer, with what it reported. */
function qualifier(
  pipeline: Record<string, unknown>,
  fetch?: Parameters<typeof createQualifier>[0]["fetch"],
) {
  const reports: SourceCommitReport[] = [];
  const qualify = createQualifier({
    origin: "https://woodpecker.sjer.red",
    repositoryId: 1,
    token: "test-only-credential",
    recordSourceCommit: (report) => {
      reports.push(report);
      return Promise.resolve();
    },
    fetch: fetch ?? (() => Promise.resolve(Response.json(pipeline))),
  });
  return { qualify, reports };
}

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
    "CI %s finished=%s qualifies as %s and reports the commit's message and author for the build and request",
    async (status, finished, expected) => {
      const { qualify, reports } = qualifier({
        number: 42,
        commit: build.sourceRevision,
        message: MESSAGE,
        author: "shepherdjerred",
        branch: "main",
        event: "push",
        status,
        finished,
      });
      expect(await qualify(build)).toBe(expected);
      expect(reports).toEqual([
        {
          sourceRevision: build.sourceRevision,
          message: MESSAGE,
          author: "shepherdjerred",
          pipelineNumber: 42,
          buildId: "build-42",
          actor: testExecutor,
          requestId: "qualify-request",
        },
      ]);
    },
  );
  test("a successful PR or different commit is not an eligible main build and reports nothing", async () => {
    const { qualify, reports } = qualifier({
      number: 42,
      commit: "b".repeat(40),
      message: MESSAGE,
      author: "shepherdjerred",
      branch: "main",
      event: "pull_request",
      status: "success",
      finished: 123,
    });
    await expect(qualify(build)).rejects.toMatchObject({ code: "INVALID" });
    expect(reports).toEqual([]);
  });
  test("a ci service image build registered from its main push pipeline verifies", async () => {
    const lane = {
      ciUrl: "https://woodpecker.sjer.red/repos/1/pipeline/77",
      sourceRevision: "c".repeat(40),
      buildId: "build-77",
      ...asked,
    };
    const { qualify } = qualifier({}, (input) => {
      if (!(input instanceof URL))
        throw new TypeError("Qualifier must request an exact pipeline URL");
      expect(input.href).toBe(
        "https://woodpecker.sjer.red/api/repos/1/pipelines/77",
      );
      return Promise.resolve(
        Response.json({
          number: 77,
          commit: lane.sourceRevision,
          message: MESSAGE,
          author: "shepherdjerred",
          branch: "main",
          event: "push",
          status: "success",
          finished: 456,
        }),
      );
    });
    expect(await qualify(lane)).toBe("verified");
  });
  test("an empty message or author is what Woodpecker said, and is reported as such", async () => {
    const { qualify, reports } = qualifier({
      number: 42,
      commit: build.sourceRevision,
      message: "",
      author: "",
      branch: "main",
      event: "push",
      status: "success",
      finished: 123,
    });
    expect(await qualify(build)).toBe("verified");
    expect(reports).toMatchObject([{ message: "", author: "" }]);
  });
  test("a pipeline without a message or an author breaks the Woodpecker contract", async () => {
    const pipeline = {
      number: 42,
      commit: build.sourceRevision,
      branch: "main",
      event: "push",
      status: "success",
      finished: 123,
    };
    for (const partial of [
      { ...pipeline, author: "shepherdjerred" },
      { ...pipeline, message: MESSAGE },
    ]) {
      const { qualify, reports } = qualifier(partial);
      await expect(qualify(build)).rejects.toMatchObject({ name: "ZodError" });
      expect(reports).toEqual([]);
    }
  });
  test("a commit that cannot be recorded is not qualified", async () => {
    const qualify = createQualifier({
      origin: "https://woodpecker.sjer.red",
      repositoryId: 1,
      token: "test-only-credential",
      recordSourceCommit: () => Promise.reject(new Error("database down")),
      fetch: () =>
        Promise.resolve(
          Response.json({
            number: 42,
            commit: build.sourceRevision,
            message: MESSAGE,
            author: "shepherdjerred",
            branch: "main",
            event: "push",
            status: "success",
            finished: 123,
          }),
        ),
    });
    await expect(qualify(build)).rejects.toThrow("database down");
  });
  test("missing credentials and upstream failures fail closed", async () => {
    await expect(
      createQualifier({
        origin: "https://woodpecker.sjer.red",
        repositoryId: 1,
        token: undefined,
        recordSourceCommit: unreachable,
      })(build),
    ).rejects.toMatchObject({ code: "PAUSED" });
    await expect(
      createQualifier({
        origin: "https://woodpecker.sjer.red",
        repositoryId: 1,
        token: "test-only-credential",
        recordSourceCommit: unreachable,
        fetch: async () => new Response("denied", { status: 403 }),
      })(build),
    ).rejects.toMatchObject({ code: "PAUSED" });
  });
});
