import { describe, expect, test } from "bun:test";
import { codexProvider } from "@shepherdjerred/code-review";
import {
  parseBuildkiteBuild,
  parsePrList,
  reviewFindingsFromThreads,
} from "@shepherdjerred/pr-fleet-controller/src/evidence-parsers.ts";
import { WorkerResultSchema } from "@shepherdjerred/pr-fleet-controller/src/schemas.ts";

describe("external evidence parsing", () => {
  test("keeps only badged provider threads as blocking findings", () => {
    const findings = reviewFindingsFromThreads(
      [
        {
          id: "provider-badged",
          author: "chatgpt-codex-connector[bot]",
          body: "![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat) Broken invariant",
          resolved: false,
          outdated: false,
        },
        {
          id: "provider-unbadged",
          author: "chatgpt-codex-connector",
          body: "This changes retry behavior, but has no severity badge.",
          resolved: false,
          outdated: false,
        },
        {
          id: "human-thread",
          author: "some-maintainer",
          body: "![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat) discussion",
          resolved: false,
          outdated: false,
        },
        {
          id: "impersonator",
          author: "chatgpt-codex-connector-evil",
          body: "![P0 Badge](https://img.shields.io/badge/P0-red?style=flat) spoofed",
          resolved: false,
          outdated: false,
        },
      ],
      codexProvider,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.id).toBe("provider-badged");
    expect(findings[0]?.severity).toBe("P2");
  });

  test("captures author type so the bot-author skip policy can apply", () => {
    const prs = parsePrList(
      JSON.stringify([
        {
          number: 1,
          title: "human PR",
          url: "https://github.com/shepherdjerred/monorepo/pull/1",
          isDraft: false,
          author: { login: "shepherdjerred", is_bot: false },
          labels: [],
          headRefName: "feature/x",
          headRefOid: "a".repeat(40),
          baseRefName: "main",
          isCrossRepository: false,
          maintainerCanModify: true,
        },
        {
          number: 2,
          title: "renovate PR",
          url: "https://github.com/shepherdjerred/monorepo/pull/2",
          isDraft: false,
          author: { login: "renovate", is_bot: true },
          labels: [],
          headRefName: "renovate/dep",
          headRefOid: "b".repeat(40),
          baseRefName: "main",
          isCrossRepository: false,
          maintainerCanModify: true,
        },
      ]),
    );
    expect(prs[0]?.authorType).toBe("User");
    expect(prs[1]?.authorType).toBe("Bot");
  });

  test("validates Buildkite job metadata without loose casts", () => {
    const build = parseBuildkiteBuild(
      JSON.stringify({
        commit: "abc",
        jobs: [
          {
            id: "job",
            name: "verify",
            state: "failed",
            web_url: "https://buildkite.com/example/builds/1#job",
            started_at: "2026-07-29T00:00:00Z",
            soft_failed: false,
          },
        ],
      }),
    );
    expect(build.commit).toBe("abc");
    expect(build.jobs[0]?.name).toBe("verify");
  });
});

test("worker structured output fails closed when required fields are absent", () => {
  expect(() => WorkerResultSchema.parse({ pr: 1, state: "green" })).toThrow();
});
