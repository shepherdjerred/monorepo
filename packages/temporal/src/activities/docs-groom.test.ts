import { describe, expect, it } from "bun:test";
import {
  extractJsonObject,
  isSecretPath,
  parseGitStatus,
  parseGroomResult,
  parseImplementResult,
  parsePrListOutput,
  parsePrNumberFromUrl,
  slugifyTaskTitle,
  stripJsonFences,
} from "./docs-groom-utils.ts";

describe("slugifyTaskTitle", () => {
  it("kebab-cases a normal title", () => {
    expect(
      slugifyTaskTitle("Rewrite renovate cleanup against current state"),
    ).toBe("rewrite-renovate-cleanup-against-current-state");
  });

  it("collapses multiple non-alphanumerics into one dash", () => {
    expect(slugifyTaskTitle("Foo!! @bar  -- baz")).toBe("foo-bar-baz");
  });

  it("strips leading and trailing dashes", () => {
    expect(slugifyTaskTitle("--foo--")).toBe("foo");
  });

  it("falls back to 'task' for empty input", () => {
    expect(slugifyTaskTitle("!!!")).toBe("task");
    expect(slugifyTaskTitle("")).toBe("task");
  });

  it("truncates to 50 chars and trims trailing dashes", () => {
    const long = "x".repeat(60) + " test";
    const out = slugifyTaskTitle(long);
    expect(out.length).toBeLessThanOrEqual(50);
    expect(out.endsWith("-")).toBe(false);
  });

  it("is deterministic", () => {
    const t = "Verify implemented plan against actual code";
    expect(slugifyTaskTitle(t)).toBe(slugifyTaskTitle(t));
  });
});

describe("isSecretPath", () => {
  it.each([
    [".env", true],
    [".env.production", true],
    ["packages/foo/.env.local", true],
    ["secrets/server.key", true],
    ["certs/cluster.pem", true],
    ["bundles/identity.pfx", true],
    ["~/.ssh/id_rsa", true],
    ["~/.ssh/id_ed25519.pub", true],
    ["keys/private.gpg", true],
    ["packages/docs/index.md", false],
    ["packages/temporal/src/worker.ts", false],
    ["envoy.ts", false],
    ["readme.env.md", false],
  ] as const)("%s → %p", (path, expected) => {
    expect(isSecretPath(path)).toBe(expected);
  });
});

describe("parseGitStatus", () => {
  it("parses simple modifications", () => {
    const out = parseGitStatus(
      " M packages/docs/index.md\n M packages/docs/guides/foo.md\n",
    );
    expect(out).toEqual([
      "packages/docs/index.md",
      "packages/docs/guides/foo.md",
    ]);
  });

  it("parses additions and deletions", () => {
    const out = parseGitStatus(
      "?? packages/docs/new.md\n D packages/docs/old.md\n",
    );
    expect(out).toEqual(["packages/docs/new.md", "packages/docs/old.md"]);
  });

  it("parses renames as the new path", () => {
    const out = parseGitStatus(
      "R  packages/docs/old.md -> packages/docs/archive/old.md\n",
    );
    expect(out).toEqual(["packages/docs/archive/old.md"]);
  });

  it("returns empty array for empty status", () => {
    expect(parseGitStatus("")).toEqual([]);
    expect(parseGitStatus("\n")).toEqual([]);
  });
});

describe("parsePrNumberFromUrl", () => {
  it("extracts number from a real gh URL", () => {
    expect(
      parsePrNumberFromUrl(
        "https://github.com/shepherdjerred/monorepo/pull/595",
      ),
    ).toBe(595);
  });

  it("trims trailing whitespace", () => {
    expect(
      parsePrNumberFromUrl(
        "https://github.com/shepherdjerred/monorepo/pull/12\n",
      ),
    ).toBe(12);
  });

  it("throws on garbage input", () => {
    expect(() => parsePrNumberFromUrl("not a url")).toThrow();
  });
});

describe("parsePrListOutput", () => {
  it("parses gh pr list --json output", () => {
    const json = JSON.stringify([
      { number: 1, state: "OPEN", closedAt: null },
      { number: 2, state: "CLOSED", closedAt: "2026-04-20T10:00:00Z" },
      { number: 3, state: "MERGED", closedAt: "2026-04-15T10:00:00Z" },
    ]);
    const out = parsePrListOutput(json);
    expect(out.length).toBe(3);
    expect(out[0]).toMatchObject({ number: 1, state: "OPEN" });
    expect(out[1]?.closedAt).toBe("2026-04-20T10:00:00Z");
  });

  it("returns empty for empty input", () => {
    expect(parsePrListOutput("")).toEqual([]);
  });

  it("skips entries with bad shapes", () => {
    const json = JSON.stringify([
      { number: 1, state: "OPEN" },
      { number: "not-a-number", state: "OPEN" },
      { state: "OPEN" },
      { number: 2, state: "WEIRD" },
      { number: 3, state: "OPEN" },
    ]);
    const out = parsePrListOutput(json);
    expect(out.map((e) => e.number)).toEqual([1, 3]);
  });
});

describe("stripJsonFences", () => {
  it("removes ```json fence", () => {
    expect(stripJsonFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("removes plain ``` fence", () => {
    expect(stripJsonFences('```\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("returns input unchanged when no fences", () => {
    expect(stripJsonFences('{"a":1}')).toBe('{"a":1}');
  });

  it("trims surrounding whitespace", () => {
    expect(stripJsonFences('\n\n  {"a":1}  \n')).toBe('{"a":1}');
  });
});

describe("extractJsonObject", () => {
  it("returns clean JSON unchanged", () => {
    expect(extractJsonObject('{"a":1}')).toBe('{"a":1}');
  });

  it("strips fences", () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("extracts JSON after leading prose", () => {
    expect(
      extractJsonObject('All looks good. Here is the audit:\n\n{"a":1}'),
    ).toBe('{"a":1}');
  });

  it("extracts JSON before trailing prose", () => {
    expect(extractJsonObject('{"a":1}\n\nThat\'s the result.')).toBe('{"a":1}');
  });

  it("extracts JSON wrapped in prose on both sides", () => {
    expect(
      extractJsonObject('All good.\n\n```json\n{"a":[1,2,3]}\n```\n\nDone.'),
    ).toBe('{"a":[1,2,3]}');
  });

  it("handles braces inside string literals", () => {
    const input = 'Prelude: {"text":"value with } and { braces","n":1}';
    expect(extractJsonObject(input)).toBe(
      '{"text":"value with } and { braces","n":1}',
    );
  });

  it("handles escaped quotes inside string literals", () => {
    const input = String.raw`Note: {"a":"he said \"hi\"","b":2}`;
    expect(extractJsonObject(input)).toBe(
      String.raw`{"a":"he said \"hi\"","b":2}`,
    );
  });

  it("supports top-level arrays", () => {
    expect(extractJsonObject("Result: [1,2,3]")).toBe("[1,2,3]");
  });

  it("throws when no JSON is present", () => {
    expect(() => extractJsonObject("All looks good. No tasks today.")).toThrow(
      /No JSON object/,
    );
  });

  it("throws on unterminated JSON", () => {
    expect(() => extractJsonObject('Output: {"a":1, "b":')).toThrow(
      /Unterminated JSON/,
    );
  });
});

describe("parseGroomResult", () => {
  it("parses a minimal valid result", () => {
    const json = JSON.stringify({
      summary: "Did some grooming work.",
      groomedFiles: ["packages/docs/index.md"],
      tasks: [],
    });
    const out = parseGroomResult(json);
    expect(out.summary).toBe("Did some grooming work.");
    expect(out.groomedFiles).toEqual(["packages/docs/index.md"]);
    expect(out.tasks).toEqual([]);
  });

  it("parses with tasks", () => {
    const json = JSON.stringify({
      summary: "Identified 1 task to do.",
      groomedFiles: [],
      tasks: [
        {
          title: "Rewrite renovate cleanup doc",
          slug: "rewrite-renovate-cleanup",
          description:
            "The doc archive/stale/2026-04-21_renovate-dashboard-cleanup.md is stale; rewrite it against current state.",
          difficulty: "medium",
          files: [
            "packages/docs/archive/stale/2026-04-21_renovate-dashboard-cleanup.md",
          ],
          category: "stale",
        },
      ],
    });
    const out = parseGroomResult(json);
    expect(out.tasks.length).toBe(1);
    expect(out.tasks[0]?.slug).toBe("rewrite-renovate-cleanup");
    expect(out.tasks[0]?.difficulty).toBe("medium");
  });

  it("strips fences before parsing", () => {
    const json = JSON.stringify({
      summary: "Wrapped in fences.",
      groomedFiles: [],
      tasks: [],
    });
    const out = parseGroomResult("```json\n" + json + "\n```");
    expect(out.summary).toBe("Wrapped in fences.");
  });

  it("tolerates leading narrative prose around the JSON", () => {
    const json = JSON.stringify({
      summary: "Found one task.",
      groomedFiles: [],
      tasks: [],
    });
    const out = parseGroomResult(
      "All looks good. Here is the audit result:\n\n" + json,
    );
    expect(out.summary).toBe("Found one task.");
  });

  it("coerces invented category values to 'other'", () => {
    const json = JSON.stringify({
      summary: "Identified two tasks with bad categories.",
      groomedFiles: [],
      tasks: [
        {
          title: "Document the auth pattern",
          slug: "document-auth-pattern",
          description:
            "Write a short patterns doc covering the new auth middleware approach.",
          difficulty: "medium",
          files: ["packages/docs/patterns/auth.md"],
          category: "architecture",
        },
        {
          title: "Add a guide for the kubectl helper",
          slug: "kubectl-helper-guide",
          description:
            "Author a guides/ doc walking through the most common kubectl-helper flows.",
          difficulty: "easy",
          files: ["packages/docs/guides/kubectl-helper.md"],
          category: "guide",
        },
      ],
    });
    const out = parseGroomResult(json);
    expect(out.tasks.length).toBe(2);
    expect(out.tasks[0]?.category).toBe("other");
    expect(out.tasks[1]?.category).toBe("other");
  });

  it("preserves valid categories untouched", () => {
    const json = JSON.stringify({
      summary: "One stale doc to archive.",
      groomedFiles: [],
      tasks: [
        {
          title: "Archive the old renovate cleanup doc",
          slug: "archive-renovate-cleanup",
          description:
            "Move 2026-04-21_renovate-dashboard-cleanup.md into archive/superseded/.",
          difficulty: "easy",
          files: ["packages/docs/archive/superseded/foo.md"],
          category: "stale",
        },
      ],
    });
    const out = parseGroomResult(json);
    expect(out.tasks[0]?.category).toBe("stale");
  });

  it("truncates over-length titles to schema cap", () => {
    const longTitle = "x".repeat(200);
    const json = JSON.stringify({
      summary: "Got an over-length title.",
      groomedFiles: [],
      tasks: [
        {
          title: longTitle,
          slug: "long-title",
          description:
            "This task has a title beyond the 120-char schema cap; the parser must truncate it.",
          difficulty: "easy",
          files: [],
          category: "other",
        },
      ],
    });
    const out = parseGroomResult(json);
    expect(out.tasks[0]?.title.length).toBeLessThanOrEqual(120);
    expect(out.tasks[0]?.title.endsWith("…")).toBe(true);
  });

  it("normalizes non-kebab-case slugs", () => {
    const json = JSON.stringify({
      summary: "Bad slug shape.",
      groomedFiles: [],
      tasks: [
        {
          title: "Some task",
          slug: "Bad Slug With Spaces",
          description:
            "This task has a slug that violates the kebab-case regex; the parser normalizes it.",
          difficulty: "easy",
          files: [],
          category: "other",
        },
      ],
    });
    const out = parseGroomResult(json);
    expect(out.tasks[0]?.slug).toMatch(/^[a-z0-9-]+$/);
    expect(out.tasks[0]?.slug).toBe("bad-slug-with-spaces");
  });

  it("rejects empty slug after normalization (e.g. all punctuation)", () => {
    const json = JSON.stringify({
      summary: "Task with unfixable slug.",
      groomedFiles: [],
      tasks: [
        {
          title: "Some title",
          slug: "!!!",
          description:
            "This description is long enough to satisfy the minimum length requirement.",
          difficulty: "easy",
          files: [],
          category: "other",
        },
      ],
    });
    // slugifyTaskTitle returns "task" for unparseable input, which is a
    // valid kebab-case slug — so this should now PASS via coercion.
    const out = parseGroomResult(json);
    expect(out.tasks[0]?.slug).toBe("task");
  });

  it("rejects bad difficulty", () => {
    const json = JSON.stringify({
      summary: "Task with bad difficulty.",
      groomedFiles: [],
      tasks: [
        {
          title: "Some title",
          slug: "some-slug",
          description: "Long enough description for the schema validation.",
          difficulty: "trivial",
          files: [],
          category: "other",
        },
      ],
    });
    expect(() => parseGroomResult(json)).toThrow();
  });
});

describe("parseImplementResult", () => {
  it("parses valid output", () => {
    const json = JSON.stringify({
      summary: "Implemented the task.",
      filesChanged: ["packages/docs/index.md", "packages/docs/guides/foo.md"],
    });
    const out = parseImplementResult(json);
    expect(out.filesChanged.length).toBe(2);
  });

  it("rejects empty filesChanged", () => {
    const json = JSON.stringify({
      summary: "Did nothing.",
      filesChanged: [],
    });
    expect(() => parseImplementResult(json)).toThrow();
  });
});
