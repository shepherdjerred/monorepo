import { describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  enrichBootstrapWithWorkdir,
  runBootstrap,
  type BootstrapOctokit,
  type BootstrapResult,
} from "./bootstrap.ts";
import type { PrReviewPipelineInput } from "#shared/schemas.ts";
import type { CloneParams, WorkdirDeps } from "#lib/pr-review-workdir.ts";

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

  it("returns blockDiffs as the empty array until the bootstrap newSource fetch lands", async () => {
    const octokit = makeOctokit({ files: [], contents: new Map() });
    const result = await runBootstrap(octokit, PIPELINE, () => {
      // intentionally silent
    });
    expect(result.blockDiffs).toEqual([]);
  });
});

/**
 * Helper: provision a real temp dir, prepopulate the requested files,
 * and return a `WorkdirDeps` whose `clone` is a no-op (the workdir is
 * already there) and whose `readFileUtf8` reads via Bun.file().
 *
 * Lives outside the describe block per ESLint
 * `unicorn/consistent-function-scoping` — async helpers don't capture
 * locals, so they belong at module scope.
 *
 * We use a real filesystem fixture because `buildSymbolIndex` scans
 * the disk via `Glob` and we can't substitute its file-system reads
 * via injected deps.
 */
async function makeRealWorkdirFixture(files: Map<string, string>): Promise<{
  deps: WorkdirDeps;
  cleanup: () => Promise<void>;
  rootBase: string;
}> {
  const rootBase = await mkdtemp(
    path.join(tmpdir(), "pr-review-workdir-test-"),
  );
  let pendingDest: string | null = null;
  const deps: WorkdirDeps = {
    mkdir: async (p: string) => {
      await mkdir(p, { recursive: true });
    },
    rmrf: async () => {
      // No-op for tests so the prepopulated fixture survives.
      await Promise.resolve();
    },
    readFileUtf8: async (p: string) => {
      const file = Bun.file(p);
      if (!(await file.exists())) return null;
      return await file.text();
    },
    clone: async (params: CloneParams) => {
      // Materialize the fixture at the requested dest path.
      pendingDest = params.dest;
      await mkdir(params.dest, { recursive: true });
      for (const [relPath, content] of files) {
        const target = path.join(params.dest, relPath);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, content, "utf8");
      }
    },
  };
  return {
    deps,
    rootBase,
    cleanup: async () => {
      await rm(rootBase, { recursive: true, force: true });
      if (pendingDest !== null) {
        await rm(pendingDest, { recursive: true, force: true });
      }
    },
  };
}

describe("enrichBootstrapWithWorkdir", () => {
  const BASE: BootstrapResult = {
    workdir: "",
    changedFiles: [
      {
        path: "packages/foo/src/index.ts",
        status: "modified",
        additions: 2,
        deletions: 1,
        patch:
          "@@ -1,3 +1,4 @@\n function greet() {\n-  return 1;\n+  return 2;\n }",
      },
      {
        // Deleted from head — should be skipped by computeBlockDiffsForFiles.
        path: "packages/foo/src/old.ts",
        status: "removed",
        additions: 0,
        deletions: 5,
        patch: "@@ -1,5 +0,0 @@\n-export const old = 1;",
      },
      {
        // Binary / no-patch — should also be skipped.
        path: "packages/foo/assets/blob.bin",
        status: "modified",
        additions: 0,
        deletions: 0,
        patch: null,
      },
    ],
    claudeMdHierarchy: [],
    retrievedSymbols: [],
    blockDiffs: [],
  };

  it("populates workdir, retrievedSymbols, and blockDiffs from the cloned tree", async () => {
    const fixture = await makeRealWorkdirFixture(
      new Map([
        [
          "packages/foo/src/index.ts",
          "export function greet() {\n  return 2;\n}\n",
        ],
      ]),
    );
    try {
      const heartbeats: string[] = [];
      const enriched = await enrichBootstrapWithWorkdir({
        base: BASE,
        pipeline: PIPELINE,
        workflowId: "wf-enrich-test",
        env: { GH_TOKEN: "tok" },
        deps: { workdir: fixture.deps, recallSearch: null },
        heartbeat: (note) => heartbeats.push(note),
      });

      expect(enriched.workdir).toContain("pr-review-workdir");
      expect(enriched.workdir).toContain("wf-enrich-test");
      expect(heartbeats).toContain("provisioning-workdir");
      expect(heartbeats).toContain("building-symbol-index");
      expect(heartbeats).toContain("running-hybrid-retrieval");
      expect(heartbeats).toContain("computing-block-diffs");

      // Block diff includes the index.ts file but NOT the removed or binary entries.
      const blockPaths = enriched.blockDiffs.map((d) => d.file);
      expect(blockPaths).toContain("packages/foo/src/index.ts");
      expect(blockPaths).not.toContain("packages/foo/src/old.ts");
      expect(blockPaths).not.toContain("packages/foo/assets/blob.bin");

      // Retrieval ran (recallSearch=null skips semantic; lexical-only path
      // may or may not find a match depending on identifier overlap).
      // We assert the structure is well-formed regardless.
      for (const r of enriched.retrievedSymbols) {
        expect(r.entry.name.length).toBeGreaterThan(0);
        expect(typeof r.score).toBe("number");
        expect(typeof r.snippet).toBe("string");
      }
    } finally {
      await fixture.cleanup();
    }
  });

  it("propagates clone failures (does NOT silently empty-fallback)", async () => {
    const failingDeps: WorkdirDeps = {
      mkdir: async () => {
        await Promise.resolve();
      },
      rmrf: async () => {
        await Promise.resolve();
      },
      readFileUtf8: async () => null,
      clone: async () => {
        await Promise.resolve();
        throw new Error("git: command not found");
      },
    };
    await expect(
      enrichBootstrapWithWorkdir({
        base: BASE,
        pipeline: PIPELINE,
        workflowId: "wf-fail-clone",
        env: { GH_TOKEN: "tok" },
        deps: { workdir: failingDeps, recallSearch: null },
        heartbeat: () => {
          // no-op for tests
        },
      }),
    ).rejects.toThrow(/git: command not found/);
  });

  it("returns empty blockDiffs when no changed files are readable from the workdir", async () => {
    const fixture = await makeRealWorkdirFixture(new Map());
    try {
      const enriched = await enrichBootstrapWithWorkdir({
        base: BASE,
        pipeline: PIPELINE,
        workflowId: "wf-empty",
        env: { GH_TOKEN: "tok" },
        deps: { workdir: fixture.deps, recallSearch: null },
        heartbeat: () => {
          // no-op for tests
        },
      });
      expect(enriched.blockDiffs).toEqual([]);
    } finally {
      await fixture.cleanup();
    }
  });
});
