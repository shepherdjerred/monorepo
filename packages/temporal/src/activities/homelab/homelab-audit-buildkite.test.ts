import { describe, expect, test } from "vitest";
import { collectBuildkiteWith } from "./homelab-audit-buildkite.ts";

function build(number: number, state = "passed") {
  return {
    number,
    state,
    web_url: `https://buildkite.com/sjerred/monorepo/builds/${number.toString()}`,
    commit: `commit-${number.toString()}`,
    jobs: [],
  };
}

describe("Buildkite homelab collector", () => {
  test("paginates over every main build in the 24-hour window", async () => {
    const paths: string[] = [];
    const firstPage = Array.from({ length: 100 }, (_, index) =>
      build(index + 1),
    );
    const result = await collectBuildkiteWith({
      now: new Date("2026-08-10T18:00:00.000Z"),
      request: (path) => {
        paths.push(path);
        const page = new URL(
          `https://api.buildkite.com${path}`,
        ).searchParams.get("page");
        return Promise.resolve(page === "1" ? firstPage : [build(101)]);
      },
    });

    expect(paths).toHaveLength(2);
    expect(paths[0]).toContain("branch=main");
    expect(paths[0]).toContain("created_from=2026-08-09T18%3A00%3A00.000Z");
    expect(paths[0]).toContain("per_page=100");
    expect(result.check.summary).toContain(
      "0 failed of 101 main builds in 24h",
    );
    expect(result.check.summary).toContain("latest #101 passed");
    expect(result.evidence.url).toBe(
      "https://buildkite.com/sjerred/monorepo/builds/101",
    );
    expect(result.findings).toEqual([]);
  });

  test.each(["failed", "canceled", "blocked"])(
    "reports the latest %s main build",
    async (state) => {
      const requests: string[] = [];
      const latest = {
        ...build(102, state),
        jobs:
          state === "failed"
            ? [
                {
                  id: "job-102",
                  name: "root verify",
                  state: "failed",
                  web_url: null,
                },
              ]
            : [],
      };
      const result = await collectBuildkiteWith({
        now: new Date("2026-08-10T18:00:00.000Z"),
        request: (path) => {
          requests.push(path);
          return Promise.resolve(
            path.endsWith("/log")
              ? { content: "deterministic failure cause" }
              : [latest, build(101)],
          );
        },
      });

      expect(result.check.summary).toContain(`latest #102 ${state}`);
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0]?.summary).toBe(
        `Buildkite main build #102 ${state}`,
      );
      expect(requests.filter((path) => path.endsWith("/log"))).toHaveLength(
        state === "failed" ? 1 : 0,
      );
    },
  );

  test("ignores an older canceled build after main returns green", async () => {
    const result = await collectBuildkiteWith({
      now: new Date("2026-08-10T18:00:00.000Z"),
      request: () =>
        Promise.resolve([build(102, "passed"), build(101, "canceled")]),
    });

    expect(result.check.summary).toContain("latest #102 passed");
    expect(result.findings).toEqual([]);
  });

  test("reports an attention finding when no main build exists in the window", async () => {
    const result = await collectBuildkiteWith({
      now: new Date("2026-08-10T18:00:00.000Z"),
      request: () => Promise.resolve([]),
    });

    expect(result.check.status).toBe("passed");
    expect(result.findings[0]?.summary).toContain("No Buildkite main builds");
  });
});
