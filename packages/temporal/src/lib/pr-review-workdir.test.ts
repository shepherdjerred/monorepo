import { describe, expect, it } from "bun:test";
import {
  cleanupWorkdir,
  provisionWorkdir,
  workdirPathFor,
  WorkdirEnvSchema,
  type CloneParams,
  type WorkdirDeps,
} from "./pr-review-workdir.ts";

function makeFakeDeps(opts: {
  cloneError?: string;
  mkdirError?: string;
  files?: Map<string, string>;
}): {
  deps: WorkdirDeps;
  calls: {
    mkdir: string[];
    rmrf: string[];
    clone: CloneParams[];
    read: string[];
  };
} {
  const mkdirCalls: string[] = [];
  const rmrfCalls: string[] = [];
  const cloneCalls: CloneParams[] = [];
  const readCalls: string[] = [];
  const calls = {
    mkdir: mkdirCalls,
    rmrf: rmrfCalls,
    clone: cloneCalls,
    read: readCalls,
  };
  return {
    calls,
    deps: {
      mkdir: async (path) => {
        await Promise.resolve();
        calls.mkdir.push(path);
        if (opts.mkdirError !== undefined) {
          throw new Error(opts.mkdirError);
        }
      },
      rmrf: async (path) => {
        await Promise.resolve();
        calls.rmrf.push(path);
      },
      readFileUtf8: async (path) => {
        await Promise.resolve();
        calls.read.push(path);
        return opts.files?.get(path) ?? null;
      },
      clone: async (params) => {
        await Promise.resolve();
        calls.clone.push(params);
        if (opts.cloneError !== undefined) {
          throw new Error(opts.cloneError);
        }
      },
    },
  };
}

describe("WorkdirEnvSchema", () => {
  it("requires GH_TOKEN to be non-empty", () => {
    expect(() => WorkdirEnvSchema.parse({ GH_TOKEN: "" })).toThrow();
    expect(() => WorkdirEnvSchema.parse({})).toThrow();
    expect(() => WorkdirEnvSchema.parse({ GH_TOKEN: "abc" })).not.toThrow();
  });
});

describe("workdirPathFor", () => {
  it("places the workdir under /tmp/pr-review-workdir/", () => {
    const result = workdirPathFor("simple-id");
    expect(result.startsWith("/tmp/pr-review-workdir/")).toBe(true);
  });

  it("sanitizes path-unsafe characters from the workflow id", () => {
    const result = workdirPathFor("wf/123:abc def");
    // Forbidden characters get replaced with `_`. No `/` inside the last component.
    const last = result.split("/").pop() ?? "";
    expect(last).toMatch(/^[\w.-]+$/);
    expect(last).not.toContain("/");
    expect(last).not.toContain(":");
    expect(last).not.toContain(" ");
  });

  it("returns distinct paths for distinct workflow ids", () => {
    expect(workdirPathFor("wf-a")).not.toBe(workdirPathFor("wf-b"));
  });
});

describe("provisionWorkdir", () => {
  it("mkdirs the root, removes any stale workdir, then clones into it", async () => {
    const { deps, calls } = makeFakeDeps({});
    const path = await provisionWorkdir({
      workflowId: "wf-123",
      owner: "shepherdjerred",
      repo: "monorepo",
      ref: "abc1234",
      env: { GH_TOKEN: "tok" },
      deps,
    });
    expect(path).toBe(workdirPathFor("wf-123"));
    expect(calls.mkdir).toEqual(["/tmp/pr-review-workdir"]);
    expect(calls.rmrf).toEqual([path]);
    expect(calls.clone).toHaveLength(1);
    expect(calls.clone[0]?.dest).toBe(path);
    expect(calls.clone[0]?.ref).toBe("abc1234");
    expect(calls.clone[0]?.env.GH_TOKEN).toBe("tok");
  });

  it("propagates clone failures (does NOT silently empty-fallback)", async () => {
    const { deps } = makeFakeDeps({ cloneError: "git: not found" });
    await expect(
      provisionWorkdir({
        workflowId: "wf-fail",
        owner: "x",
        repo: "y",
        ref: "z",
        env: { GH_TOKEN: "t" },
        deps,
      }),
    ).rejects.toThrow(/git: not found/);
  });

  it("propagates mkdir failures (deployment misconfig must surface)", async () => {
    const { deps } = makeFakeDeps({ mkdirError: "EACCES" });
    await expect(
      provisionWorkdir({
        workflowId: "wf-fail-mkdir",
        owner: "x",
        repo: "y",
        ref: "z",
        env: { GH_TOKEN: "t" },
        deps,
      }),
    ).rejects.toThrow(/EACCES/);
  });
});

describe("cleanupWorkdir", () => {
  it("rm -rf's the workdir path", async () => {
    const { deps, calls } = makeFakeDeps({});
    await cleanupWorkdir("/tmp/pr-review-workdir/wf-x", deps);
    expect(calls.rmrf).toEqual(["/tmp/pr-review-workdir/wf-x"]);
  });
});
