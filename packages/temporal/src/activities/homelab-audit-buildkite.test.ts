import { describe, expect, test } from "bun:test";
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
