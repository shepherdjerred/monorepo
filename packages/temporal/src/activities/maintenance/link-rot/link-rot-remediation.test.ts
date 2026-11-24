import { describe, expect, test } from "vitest";
import { validateLycheeIgnoreChanges } from "#activities/remediation/lychee-ignore-validation.ts";
import { createRemediationTestGitRepo } from "#activities/remediation/remediation-test-git.ts";
import {
  isAllowedLinkRotPath,
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
  test("permits only .lycheeignore and exact markdown sources while rejecting AGENTS.md and CLAUDE.md at any depth", () => {
    const linksWithInstructionSources: DeadLink[] = [
      ...DEAD_LINKS,
      {
        url: "https://example.org/dead-root-agents",
        source: "AGENTS.md",
        status: "404 Not Found",
        statusCode: 404,
      },
      {
        url: "https://example.org/dead-nested-agents",
        source: "packages/docs/wiki/AGENTS.md",
        status: "404 Not Found",
        statusCode: 404,
      },
      {
        url: "https://example.org/dead-nested-claude",
        source: "packages/scout-for-lol/CLAUDE.md",
        status: "404 Not Found",
        statusCode: 404,
      },
    ];
    expect(
      isAllowedLinkRotPath(".lycheeignore", linksWithInstructionSources),
    ).toBe(true);
    expect(isAllowedLinkRotPath("docs/a.md", linksWithInstructionSources)).toBe(
      true,
    );
    expect(isAllowedLinkRotPath("docs/b.md", linksWithInstructionSources)).toBe(
      true,
    );
    expect(
      isAllowedLinkRotPath("docs/unrelated.md", linksWithInstructionSources),
    ).toBe(false);
    expect(isAllowedLinkRotPath("AGENTS.md", linksWithInstructionSources)).toBe(
      false,
    );
    expect(
      isAllowedLinkRotPath(
        "packages/docs/wiki/AGENTS.md",
        linksWithInstructionSources,
      ),
    ).toBe(false);
    expect(
      isAllowedLinkRotPath(
        "packages/docs/wiki/agents.md",
        linksWithInstructionSources,
      ),
    ).toBe(false);
    expect(isAllowedLinkRotPath("CLAUDE.md", linksWithInstructionSources)).toBe(
      false,
    );
    expect(
      isAllowedLinkRotPath(
        "packages/scout-for-lol/CLAUDE.md",
        linksWithInstructionSources,
      ),
    ).toBe(false);
    expect(
      isAllowedLinkRotPath("src/index.ts", linksWithInstructionSources),
    ).toBe(false);
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

async function assertPartialDocsAOnly(
  repoDir: string,
  result: Awaited<ReturnType<typeof verifyLinkRotRemediation>>,
): Promise<void> {
  expect(result).toMatchObject({
    verifiedFiles: ["docs/a.md"],
    resolvedCount: 1,
    unresolvedCount: 1,
    autoMerge: false,
  });
  expect(await Bun.file(`${repoDir}/docs/b.md`).text()).toBe(
    "[b](https://example.org/dead-b)\n",
  );
}

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
        verifyHttp200: () => Promise.resolve(true),
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
        verifyHttp200: () => Promise.resolve(true),
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

      await assertPartialDocsAOnly(fixture.repoDir, result);
    } finally {
      await fixture.cleanup();
    }
  });
});

describe("verifyLinkRotRemediation timeout and HTTP 200 guards", () => {
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
        verifyHttp200: () => Promise.resolve(true),
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
        verifyHttp200: () => Promise.resolve(true),
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

      await assertPartialDocsAOnly(fixture.repoDir, partialResult);
    } finally {
      await fixture.cleanup();
    }
  });

  test("rejects newly introduced replacement URLs that return 403/429 even when lychee scan config accepts them, while preserving unchanged 403 links", async () => {
    const fixture = await createRemediationTestGitRepo({
      prefix: "link-rot-http200-",
      files: {
        ".lycheeignore": "# Existing internal host\n^https?://go/\n",
        "docs/a.md":
          "[unchanged](https://vendor.example/unchanged-403)\n[a](https://example.org/dead-a)\n",
        "docs/b.md": "[b](https://example.org/dead-b)\n",
      },
    });
    try {
      await Bun.write(
        `${fixture.repoDir}/docs/a.md`,
        "[unchanged](https://vendor.example/unchanged-403)\n[a](https://example.org/live-200)\n",
      );
      await Bun.write(
        `${fixture.repoDir}/docs/b.md`,
        "[b](https://example.org/replacement-403)\n",
      );

      const checkedUrls: string[] = [];
      let lycheeCalls = 0;
      const result = await verifyLinkRotRemediation({
        repoDir: fixture.repoDir,
        changedFiles: ["docs/a.md", "docs/b.md"],
        originalDeadLinks: DEAD_LINKS,
        beforeLycheeIgnore: "# Existing internal host\n^https?://go/\n",
        verifyHttp200: (url) => {
          checkedUrls.push(url);
          return Promise.resolve(url === "https://example.org/live-200");
        },
        runLychee: () => {
          lycheeCalls += 1;
          return Promise.resolve(
            lycheeCalls === 1
              ? lycheeJson({})
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

      expect(checkedUrls).toEqual([
        "https://example.org/live-200",
        "https://example.org/replacement-403",
      ]);
      await assertPartialDocsAOnly(fixture.repoDir, result);
    } finally {
      await fixture.cleanup();
    }
  });
});
