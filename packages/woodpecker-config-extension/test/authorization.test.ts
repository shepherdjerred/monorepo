import { describe, expect, test } from "vitest";
import { authorizePipeline, TRUSTED_ACTORS } from "#src/authorization.ts";
import { PipelineSchema } from "#src/schemas.ts";

/**
 * Built through the schema rather than as a bare object literal, so a field
 * this gate depends on cannot quietly stop being parsed.
 */
function pipeline(overrides: Record<string, unknown>) {
  return PipelineSchema.parse({
    event: "pull_request",
    branch: "main",
    commit: "a".repeat(40),
    ref: "refs/pull/1/head",
    link_url: "https://github.com/shepherdjerred/monorepo/pull/1",
    changed_files: ["README.md"],
    author: "shepherdjerred",
    sender: "shepherdjerred",
    ...overrides,
  });
}

describe("pipeline authorization", () => {
  test("admits the owner", () => {
    expect(authorizePipeline(pipeline({}))).toEqual({ allowed: true });
  });

  test("admits the repository's bots", () => {
    for (const login of ["long-summer-intern[bot]", "renovate[bot]"]) {
      const result = authorizePipeline(
        pipeline({ author: login, sender: login }),
      );
      expect(result, `${login} should be able to run CI`).toEqual({
        allowed: true,
      });
    }
  });

  test("refuses an account that is not on the allowlist", () => {
    const result = authorizePipeline(
      pipeline({ author: "mallory", sender: "mallory" }),
    );
    expect(result.allowed).toBe(false);
  });

  /**
   * The two identities answer different questions, and a pull request can
   * separate them. Neither alone is sufficient.
   */
  test("refuses a trusted author driven by an untrusted sender", () => {
    const result = authorizePipeline(pipeline({ sender: "mallory" }));
    expect(result).toEqual({
      allowed: false,
      reason: "pipeline sender is not a trusted actor",
    });
  });

  test("refuses an untrusted author re-triggered by a trusted sender", () => {
    const result = authorizePipeline(pipeline({ author: "mallory" }));
    expect(result).toEqual({
      allowed: false,
      reason: "pipeline author is not a trusted actor",
    });
  });

  test("refuses a fork even when both identities are trusted", () => {
    const result = authorizePipeline(pipeline({ from_fork: true }));
    expect(result).toEqual({
      allowed: false,
      reason: "pipeline originates from a fork",
    });
  });

  /**
   * Woodpecker omits `from_fork` when it is false, so an ordinary push arrives
   * without the field. That must read as "not a fork", not as a refusal.
   */
  test("treats an omitted from_fork as not a fork", () => {
    const pushed = PipelineSchema.parse({
      event: "push",
      branch: "main",
      commit: "b".repeat(40),
      ref: "refs/heads/main",
      link_url: "https://github.com/shepherdjerred/monorepo/commit/b",
      changed_files: [],
      author: "shepherdjerred",
      sender: "shepherdjerred",
    });
    expect(pushed.from_fork).toBe(false);
    expect(authorizePipeline(pushed)).toEqual({ allowed: true });
  });

  /**
   * Woodpecker reports a cron's name where a login would go. Recurring work in
   * this repository belongs to Temporal, so a cron reaching the extension is
   * something nobody reviewed and must not generate a pipeline.
   */
  test("refuses a cron pipeline", () => {
    const result = authorizePipeline(
      pipeline({ event: "cron", author: "nightly", sender: "nightly" }),
    );
    expect(result.allowed).toBe(false);
  });

  test("allowlists no account that is not the owner or a bot", () => {
    for (const login of TRUSTED_ACTORS) {
      expect(login === "shepherdjerred" || login.endsWith("[bot]")).toBe(true);
    }
  });
});
