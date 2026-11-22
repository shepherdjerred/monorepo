import { describe, expect, test } from "vitest";
import { createRemediationTestGitRepo } from "#activities/remediation/remediation-test-git.ts";
import {
  isAllowedLinkRotPath,
  validateLycheeIgnoreChanges,
  verifyLinkRotRemediation,
} from "./link-rot-remediation.ts";
import type { DeadLink } from "./link-rot-scan.ts";

const DEAD_LINKS: DeadLink[] = [
  {
    url: "https://example.org/dead-a",
    source: "docs/a.md",
    status: "404 Not Found",
    statusCode: 404,
    line: 4,
  },
  {
    url: "https://example.org/dead-b",
    source: "docs/b.md",
    status: "404 Not Found",
    statusCode: 404,
    line: 9,
  },
];

function lycheeJson(
  errorMap: Record<string, { url: string; text: string }[]>,
  timeoutMap: Record<string, { url: string; text: string }[]> = {},
): string {
  const mapEntries = (
    input: Record<string, { url: string; text: string }[]>,
    code?: number,
  ) =>
    Object.fromEntries(
      Object.entries(input).map(([source, links]) => [
        source,
        links.map((link) => ({
          url: link.url,
          status:
            code === undefined
              ? { text: link.text }
              : { text: link.text, code },
        })),
      ]),
    );
  const errorCount = Object.values(errorMap).reduce(
    (sum, links) => sum + links.length,
    0,
  );
  const timeoutCount = Object.values(timeoutMap).reduce(
    (sum, links) => sum + links.length,
    0,
  );
  return JSON.stringify({
    total: 10,
    successful: Math.max(0, 10 - errorCount - timeoutCount),
    errors: errorCount,
    timeouts: timeoutCount,
    excludes: 0,
    error_map: mapEntries(errorMap, 404),
    timeout_map: mapEntries(timeoutMap),
  });
}

function setupGitFixture() {
  return createRemediationTestGitRepo({
    prefix: "link-rot-test-",
    files: {
      ".lycheeignore": "# Existing internal host\n^https?://go/\n",
      "docs/a.md": "[a](https://example.org/dead-a)\n",
      "docs/b.md": "[b](https://example.org/dead-b)\n",
    },
  });
}

describe("isAllowedLinkRotPath", () => {
  test("permits only .lycheeignore and exact markdown sources from deadLinks", () => {
    expect(isAllowedLinkRotPath(".lycheeignore", DEAD_LINKS)).toBe(true);
    expect(isAllowedLinkRotPath("docs/a.md", DEAD_LINKS)).toBe(true);
    expect(isAllowedLinkRotPath("docs/b.md", DEAD_LINKS)).toBe(true);
    expect(isAllowedLinkRotPath("docs/unrelated.md", DEAD_LINKS)).toBe(false);
    expect(isAllowedLinkRotPath("AGENTS.md", DEAD_LINKS)).toBe(false);
    expect(isAllowedLinkRotPath("CLAUDE.md", DEAD_LINKS)).toBe(false);
    expect(isAllowedLinkRotPath("src/index.ts", DEAD_LINKS)).toBe(false);
  });
});

describe("validateLycheeIgnoreChanges", () => {
  const baseline = "# Existing internal host\n^https?://go/\n";

  test("accepts a specific ^https?:// rule preceded by a rationale comment", () => {
    const next = `${baseline}# Bot-blocked vendor documentation portal\n^https?://docs\\.vendor\\.example/guide\n`;
    expect(validateLycheeIgnoreChanges(baseline, next)).toEqual({
      valid: true,
    });
  });

  test("rejects rules without a preceding rationale comment", () => {
    const next = `${baseline}\n^https?://docs\\.vendor\\.example/guide\n`;
    expect(validateLycheeIgnoreChanges(baseline, next).valid).toBe(false);
  });

  test("rejects broad wildcard rules and invalid regexes", () => {
    expect(
      validateLycheeIgnoreChanges(baseline, `${baseline}# Broad rule\n.*\n`)
        .valid,
    ).toBe(false);
    expect(
      validateLycheeIgnoreChanges(
        baseline,
        `${baseline}# Broad https rule\n^https?://.*\n`,
      ).valid,
    ).toBe(false);
    expect(
      validateLycheeIgnoreChanges(
        baseline,
        `${baseline}# Broad non-capturing group\n^https?://(?:.*)\n`,
      ).valid,
    ).toBe(false);
    expect(
      validateLycheeIgnoreChanges(
        baseline,
        `${baseline}# Alternation escape\n^https?://docs\\.vendor\\.example/guide|.*\n`,
      ).valid,
    ).toBe(false);
    expect(
      validateLycheeIgnoreChanges(
        baseline,
        `${baseline}# Unescaped host dots\n^https?://docs.vendor.example/guide\n`,
      ).valid,
    ).toBe(false);
    expect(
      validateLycheeIgnoreChanges(
        baseline,
        `${baseline}# Broken regex\n^https?://[unclosed\n`,
      ).valid,
    ).toBe(false);
  });

  test("rejects removal of existing .lycheeignore rules", () => {
    expect(
      validateLycheeIgnoreChanges(
        baseline,
        "# Replacement comment\n^https?://other\\.host/path\n",
      ).valid,
    ).toBe(false);
  });
});

describe("verifyLinkRotRemediation", () => {
  test("enables autoMerge when all dead links are resolved cleanly", async () => {
    const fixture = await setupGitFixture();
    try {
      await Bun.write(
        `${fixture.repoDir}/docs/a.md`,
        "[a](https://example.org/live-a)\n",
      );
      await Bun.write(
        `${fixture.repoDir}/docs/b.md`,
        "[b](https://example.org/live-b)\n",
      );

      const result = await verifyLinkRotRemediation({
        repoDir: fixture.repoDir,
        changedFiles: ["docs/a.md", "docs/b.md"],
        originalDeadLinks: DEAD_LINKS,
        beforeLycheeIgnore: "# Existing internal host\n^https?://go/\n",
        runLychee: () => Promise.resolve(lycheeJson({})),
      });

      expect(result).toMatchObject({
        verifiedFiles: ["docs/a.md", "docs/b.md"],
        resolvedCount: 2,
        unresolvedCount: 0,
        autoMerge: true,
      });
    } finally {
      await fixture.cleanup();
    }
  });

  test("reverts a file that introduced a new broken link while preserving partial fix with autoMerge=false", async () => {
    const fixture = await setupGitFixture();
    try {
      await Bun.write(
        `${fixture.repoDir}/docs/a.md`,
        "[a](https://example.org/live-a)\n",
      );
      await Bun.write(
        `${fixture.repoDir}/docs/b.md`,
        "[b](https://example.org/brand-new-broken)\n",
      );

      let callCount = 0;
      const result = await verifyLinkRotRemediation({
        repoDir: fixture.repoDir,
        changedFiles: ["docs/a.md", "docs/b.md"],
        originalDeadLinks: DEAD_LINKS,
        beforeLycheeIgnore: "# Existing internal host\n^https?://go/\n",
        runLychee: () => {
          callCount += 1;
          return Promise.resolve(
            callCount === 1
              ? lycheeJson({
                  "docs/b.md": [
                    {
                      url: "https://example.org/brand-new-broken",
                      text: "404 Not Found",
                    },
                  ],
                })
              : lycheeJson({
                  "docs/b.md": [
                    {
                      url: "https://example.org/dead-b",
                      text: "404 Not Found",
                    },
                  ],
                }),
          );
        },
      });

      expect(result).toMatchObject({
        verifiedFiles: ["docs/a.md"],
        resolvedCount: 1,
        unresolvedCount: 1,
        autoMerge: false,
      });
      expect(await Bun.file(`${fixture.repoDir}/docs/b.md`).text()).toBe(
        "[b](https://example.org/dead-b)\n",
      );
    } finally {
      await fixture.cleanup();
    }
  });

  test("treats timed-out replacement links as unverified failures and prevents autoMerge", async () => {
    const fixture = await setupGitFixture();
    try {
      await Bun.write(
        `${fixture.repoDir}/docs/a.md`,
        "[a](https://example.org/slow-replacement)\n",
      );

      const singleDeadLink = [DEAD_LINKS[0]!];
      const allTimedOutResult = await verifyLinkRotRemediation({
        repoDir: fixture.repoDir,
        changedFiles: ["docs/a.md"],
        originalDeadLinks: singleDeadLink,
        beforeLycheeIgnore: "# Existing internal host\n^https?://go/\n",
        runLychee: () =>
          Promise.resolve(
            lycheeJson(
              {},
              {
                "docs/a.md": [
                  {
                    url: "https://example.org/slow-replacement",
                    text: "Timeout",
                  },
                ],
              },
            ),
          ),
      });

      expect(allTimedOutResult).toMatchObject({
        verifiedFiles: [],
        resolvedCount: 0,
        unresolvedCount: 1,
        autoMerge: false,
      });
      expect(await Bun.file(`${fixture.repoDir}/docs/a.md`).text()).toBe(
        "[a](https://example.org/dead-a)\n",
      );

      await Bun.write(
        `${fixture.repoDir}/docs/a.md`,
        "[a](https://example.org/live-a)\n",
      );
      await Bun.write(
        `${fixture.repoDir}/docs/b.md`,
        "[b](https://example.org/slow-b)\n",
      );

      let partialCalls = 0;
      const partialResult = await verifyLinkRotRemediation({
        repoDir: fixture.repoDir,
        changedFiles: ["docs/a.md", "docs/b.md"],
        originalDeadLinks: DEAD_LINKS,
        beforeLycheeIgnore: "# Existing internal host\n^https?://go/\n",
        runLychee: () => {
          partialCalls += 1;
          return Promise.resolve(
            partialCalls === 1
              ? lycheeJson(
                  {},
                  {
                    "docs/b.md": [
                      {
                        url: "https://example.org/slow-b",
                        text: "Timeout",
                      },
                    ],
                  },
                )
              : lycheeJson(
                  {},
                  {
                    "docs/b.md": [
                      {
                        url: "https://example.org/dead-b",
                        text: "Timeout",
                      },
                    ],
                  },
                ),
          );
        },
      });

      expect(partialResult).toMatchObject({
        verifiedFiles: ["docs/a.md"],
        resolvedCount: 1,
        unresolvedCount: 1,
        autoMerge: false,
      });
      expect(await Bun.file(`${fixture.repoDir}/docs/b.md`).text()).toBe(
        "[b](https://example.org/dead-b)\n",
      );
    } finally {
      await fixture.cleanup();
    }
  });
});
