import { describe, expect, it } from "bun:test";
import { runBootstrap, type BootstrapOctokit } from "./bootstrap.ts";
import type { PrReviewPipelineInput } from "#shared/schemas.ts";

const PIPELINE: PrReviewPipelineInput = {
  owner: "shepherdjerred",
  repo: "monorepo",
  prNumber: 724,
  commitSha: "abc1234567890abc1234567890abc1234567890ab",
  baseRef: "main",
  headRef: "feature/foo",
  prTitle: "Add foo support",
  prAuthor: "alice",
};

type PageItem = {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string | null;
};

function makeOctokit(opts: {
  files: PageItem[];
  contents: Map<string, string>;
}): BootstrapOctokit {
  const iterator = async function* () {
    yield { data: opts.files };
  };
  return {
    paginate: {
      iterator: () => iterator(),
    },
    rest: {
      pulls: { listFiles: () => Promise.resolve() },
      repos: {
        getContent: async (params) => {
          await Promise.resolve();
          const content = opts.contents.get(params.path);
          if (content === undefined) {
            // Mimic GitHub's 404 for missing CLAUDE.md at this level.
            // Using a plain Error here (vs the RequestError) means the
            // bootstrap walker rethrows — but the prod path catches
            // RequestError 404 specifically, so use that instance.
            const { RequestError } = await import("octokit");
            throw new RequestError("Not Found", 404, {
              request: { method: "GET", url: "", headers: {} },
              response: {
                status: 404,
                url: "",
                headers: {},
                data: { message: "Not Found" },
              },
            });
          }
          return {
            data: {
              type: "file",
              encoding: "base64",
              content: Buffer.from(content, "utf8").toString("base64"),
            },
          };
        },
      },
    },
  };
}

describe("foundation: bootstrap.runBootstrap", () => {
  it("lists changed files and normalizes their status + patch", async () => {
    const octokit = makeOctokit({
      files: [
        {
          filename: "packages/temporal/src/worker.ts",
          status: "modified",
          additions: 12,
          deletions: 3,
          patch: "@@ -1 +1 @@\n-a\n+b",
        },
        {
          // Octokit's response omits `patch` for binary / oversize files
          // (this is what shows up as a missing property at runtime, not
          // an explicit undefined). Omit it the same way here.
          filename: "packages/temporal/bun.lock",
          status: "modified",
          additions: 50,
          deletions: 0,
        },
        {
          filename: "packages/x/some-renamed-file.ts",
          status: "exotic-unknown-status",
          additions: 0,
          deletions: 0,
          patch: null,
        },
      ],
      contents: new Map(),
    });
    const heartbeats: string[] = [];
    const result = await runBootstrap(octokit, PIPELINE, (note) => {
      heartbeats.push(note);
    });
    expect(result.changedFiles.length).toBe(3);
    expect(result.changedFiles[0]?.path).toBe(
      "packages/temporal/src/worker.ts",
    );
    expect(result.changedFiles[0]?.patch).toContain("+b");
    expect(result.changedFiles[1]?.patch).toBe(null);
    // Unknown status falls back to "changed" rather than throwing.
    expect(result.changedFiles[2]?.status).toBe("changed");
    expect(heartbeats).toContain("listing-files");
  });

  it("walks the CLAUDE.md hierarchy root → leaf and returns the files that exist", async () => {
    const octokit = makeOctokit({
      files: [
        {
          filename: "packages/temporal/src/worker.ts",
          status: "modified",
          additions: 1,
          deletions: 1,
          patch: "@@ -1 +1 @@\n-a\n+b",
        },
      ],
      contents: new Map([
        ["CLAUDE.md", "# repo CLAUDE\n\nUse bun.\n"],
        [
          "packages/temporal/CLAUDE.md",
          "# temporal CLAUDE\n\nUse @sentry/bun.\n",
        ],
        // packages/CLAUDE.md and packages/temporal/src/CLAUDE.md are intentionally
        // missing so the walker has to handle 404 along the path.
      ]),
    });
    const result = await runBootstrap(octokit, PIPELINE, () => {
      // intentionally silent
    });
    expect(result.claudeMdHierarchy.length).toBe(2);
    const paths = result.claudeMdHierarchy.map((m) => m.path);
    expect(paths).toContain("CLAUDE.md");
    expect(paths).toContain("packages/temporal/CLAUDE.md");
    // Sort is alphabetical so packages/.../CLAUDE.md comes after root.
    expect(paths[0]).toBe("CLAUDE.md");
  });

  it("returns workdir as the empty string until Phase 5 cloning lands", async () => {
    const octokit = makeOctokit({ files: [], contents: new Map() });
    const result = await runBootstrap(octokit, PIPELINE, () => {
      // intentionally silent
    });
    expect(result.workdir).toBe("");
    expect(result.changedFiles).toEqual([]);
    expect(result.claudeMdHierarchy).toEqual([]);
  });

  it("returns retrievedSymbols as the empty array until the bootstrap clone+index lands", async () => {
    const octokit = makeOctokit({ files: [], contents: new Map() });
    const result = await runBootstrap(octokit, PIPELINE, () => {
      // intentionally silent
    });
    expect(result.retrievedSymbols).toEqual([]);
  });
});
