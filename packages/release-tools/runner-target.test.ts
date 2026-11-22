import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { Manifest } from "release-please";
import { LocalGitHub } from "release-please/build/src/local-github.js";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  initializePartialClone,
  runReleasePlease,
  type ReleasePleasePhase,
} from "./runner.ts";

const execFileAsync = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout.trim();
}

const phases = ["release-pr", "github-release"] as const;
const stages = ["resolve", "manifest", "mutation"] as const;
type MovementStage = (typeof stages)[number];
let fixtureRoot: string;
let origin: string;
let clonePath: string;
let initialSha: string;
let advanceDuringClone: boolean;
let pendingMergedCount: number;
let searchStatus: number;
let movementStage: MovementStage | undefined;
let loadedManifest: Manifest | undefined;
let onManifestLoaded: (() => Promise<void>) | undefined;

async function advanceMain(): Promise<void> {
  await Bun.write(
    path.join(origin, ".release-please-manifest.json"),
    JSON.stringify({ "packages/example": "1.1.0" }),
  );
  await git(origin, "add", ".release-please-manifest.json");
  await git(origin, "commit", "-m", "fix: advance release target");
}

const resolveTarget = vi.fn(async () => {
  const sha = await git(origin, "rev-parse", "HEAD");
  if (movementStage === "resolve") await advanceMain();
  return {
    targetBranchSha: sha,
    excludedPaths: sha === initialSha ? [] : ["packages/example"],
  };
});

function options(phase: ReleasePleasePhase) {
  return {
    phase,
    token: "fixture",
    repoUrl: "https://github.com/shepherdjerred/monorepo",
    gitRemoteUrl: pathToFileURL(origin).href,
    targetBranch: "main",
    resolveTarget,
  };
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

beforeEach(async () => {
  fixtureRoot = await mkdtemp(path.join(tmpdir(), "release-target-"));
  origin = path.join(fixtureRoot, "origin");
  clonePath = "";
  advanceDuringClone = false;
  pendingMergedCount = 1;
  searchStatus = 200;
  movementStage = undefined;
  loadedManifest = undefined;
  onManifestLoaded = undefined;
  resolveTarget.mockClear();
  await mkdir(origin);
  await git(origin, "init", "-b", "main");
  await git(origin, "config", "user.name", "Release fixture");
  await git(origin, "config", "user.email", "fixture@example.invalid");
  await git(origin, "config", "uploadpack.allowFilter", "true");
  await Bun.write(
    path.join(origin, "release-please-config.json"),
    JSON.stringify({
      "release-type": "simple",
      packages: { "packages/example": {} },
    }),
  );
  await Bun.write(
    path.join(origin, ".release-please-manifest.json"),
    JSON.stringify({ "packages/example": "1.0.0" }),
  );
  await git(
    origin,
    "add",
    "release-please-config.json",
    ".release-please-manifest.json",
  );
  await git(origin, "commit", "-m", "feat: initialize release fixture");
  initialSha = await git(origin, "rev-parse", "HEAD");

  const createLocalGitHub = LocalGitHub.create.bind(LocalGitHub);
  vi.spyOn(LocalGitHub, "create").mockImplementation(async (configuration) => {
    const localPath = configuration.localRepoPath;
    if (localPath === undefined) throw new Error("Missing temporary clone");
    clonePath = localPath;
    const github = await createLocalGitHub(configuration);
    if (advanceDuringClone) await advanceMain();
    return github;
  });
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = requestUrl(input);
    if (url.includes("/pulls?state=closed")) {
      if (searchStatus !== 200) {
        return new Response("Service Unavailable", {
          status: searchStatus,
          statusText: "Service Unavailable",
        });
      }
      return Response.json(
        Array.from({ length: pendingMergedCount }, (_, index) => ({
          number: index + 1,
          merged_at: "2026-11-21T10:00:00Z",
          labels: [{ name: "autorelease: pending" }],
        })),
      );
    }
    return Response.json({
      object: { sha: await git(origin, "rev-parse", "HEAD") },
    });
  });
  const fromManifest = Manifest.fromManifest.bind(Manifest);
  vi.spyOn(Manifest, "fromManifest").mockImplementation(async (...args) => {
    if (onManifestLoaded !== undefined) await onManifestLoaded();
    loadedManifest = await fromManifest(...args);
    if (movementStage === "manifest") await advanceMain();
    return loadedManifest;
  });
  vi.spyOn(Manifest.prototype, "buildPullRequests").mockResolvedValue([]);
  vi.spyOn(Manifest.prototype, "buildReleases").mockResolvedValue([]);
  const mutate = async () => {
    if (movementStage === "mutation") await advanceMain();
    return [];
  };
  vi.spyOn(Manifest.prototype, "createPullRequests").mockImplementation(mutate);
  vi.spyOn(Manifest.prototype, "createReleases").mockImplementation(mutate);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(fixtureRoot, { recursive: true, force: true });
});

test("release-pr resolves eligibility after a merge during cloning and fetches the new commit", async () => {
  advanceDuringClone = true;
  expect(await runReleasePlease(options("release-pr"))).toEqual({
    phase: "release-pr",
    count: 0,
  });
  expect(resolveTarget).toHaveBeenCalledOnce();
  expect(loadedManifest?.releasedVersions["packages/example"]?.toString()).toBe(
    "1.1.0",
  );
  expect(
    loadedManifest?.repositoryConfig["packages/example"]?.excludePaths,
  ).toEqual(["packages/example/"]);
  expect(await Bun.file(path.join(clonePath, ".git/config")).exists()).toBe(
    false,
  );
});

test("github-release rejects main movement during cloning because preflight bound target", async () => {
  advanceDuringClone = true;
  await expect(runReleasePlease(options("github-release"))).rejects.toThrow(
    "before release-please loaded its manifest",
  );
  expect(resolveTarget).toHaveBeenCalledOnce();
  expect(Manifest.prototype.createReleases).not.toHaveBeenCalled();
  expect(await Bun.file(path.join(clonePath, ".git/config")).exists()).toBe(
    false,
  );
});

const guardCases = phases.flatMap((phase) =>
  stages.map((stage) => ({ phase, stage })),
);
test.each(guardCases)(
  "$phase rejects main movement at $stage and cleans up its clone",
  async ({ phase, stage }) => {
    movementStage = stage;
    const expectedMessage =
      stage === "resolve"
        ? phase === "release-pr"
          ? "before release-please loaded its manifest"
          : "during release-please"
        : stage === "manifest"
          ? "while release-please loaded its manifest"
          : "during release-please";
    await expect(runReleasePlease(options(phase))).rejects.toThrow(
      expectedMessage,
    );
    if (stage === "mutation") {
      const method =
        phase === "release-pr" ? "createPullRequests" : "createReleases";
      expect(Manifest.prototype[method]).toHaveBeenCalledOnce();
    } else {
      expect(Manifest.prototype.createPullRequests).not.toHaveBeenCalled();
      expect(Manifest.prototype.createReleases).not.toHaveBeenCalled();
    }
    if (phase === "github-release" && stage === "resolve") {
      expect(LocalGitHub.create).not.toHaveBeenCalled();
    } else {
      expect(await Bun.file(path.join(clonePath, ".git/config")).exists()).toBe(
        false,
      );
    }
  },
);

describe("github-release pending-PR preflight", () => {
  test("skips local clone while still verifying target SHA when zero merged pending PRs exist", async () => {
    pendingMergedCount = 0;
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    expect(await runReleasePlease(options("github-release"))).toEqual({
      phase: "github-release",
      count: 0,
    });

    expect(resolveTarget).toHaveBeenCalledOnce();
    expect(LocalGitHub.create).not.toHaveBeenCalled();
    expect(Manifest.fromManifest).not.toHaveBeenCalled();
    expect(Manifest.prototype.createReleases).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      "No merged autorelease: pending pull requests on main; skipping local clone",
    );
  });

  test("still fails closed on target movement when zero merged pending PRs exist", async () => {
    pendingMergedCount = 0;
    movementStage = "resolve";

    await expect(runReleasePlease(options("github-release"))).rejects.toThrow(
      "during release-please",
    );
    expect(LocalGitHub.create).not.toHaveBeenCalled();
  });

  test("fails closed on non-200 search API response without cloning", async () => {
    searchStatus = 503;

    await expect(runReleasePlease(options("github-release"))).rejects.toThrow(
      "Could not query merged release pull requests on GitHub (503",
    );
    expect(resolveTarget).toHaveBeenCalledOnce();
    expect(LocalGitHub.create).not.toHaveBeenCalled();
  });

  test("proceeds with a single target resolution when merged pending PRs exist", async () => {
    pendingMergedCount = 2;
    vi.spyOn(Manifest.prototype, "createReleases").mockResolvedValue([
      {
        id: 1,
        path: "packages/example",
        version: "1.0.1",
        major: 1,
        minor: 0,
        patch: 1,
        prNumber: 42,
        tagName: "example-v1.0.1",
        sha: initialSha,
        uploadUrl: "",
        url: "",
        draft: false,
      },
    ]);

    expect(await runReleasePlease(options("github-release"))).toEqual({
      phase: "github-release",
      count: 1,
    });
    expect(resolveTarget).toHaveBeenCalledOnce();
    expect(LocalGitHub.create).toHaveBeenCalledOnce();
    expect(Manifest.prototype.createReleases).toHaveBeenCalledOnce();
  });

  test("bypasses GitHub pulls API when repoUrl uses file://", async () => {
    const pullsCalls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = requestUrl(input);
      if (url.includes("/pulls?state=closed")) pullsCalls.push(url);
      return Response.json({
        object: { sha: await git(origin, "rev-parse", "HEAD") },
      });
    });

    const localFileRepo = path.join(fixtureRoot, "owner", "repo");
    await mkdir(path.dirname(localFileRepo), { recursive: true });
    await git(
      fixtureRoot,
      "clone",
      "--no-hardlinks",
      "--",
      origin,
      localFileRepo,
    );
    await git(localFileRepo, "config", "uploadpack.allowFilter", "true");

    expect(
      await runReleasePlease({
        phase: "github-release",
        token: "fixture",
        repoUrl: pathToFileURL(localFileRepo).href,
        targetBranch: "main",
        resolveTarget,
      }),
    ).toEqual({
      phase: "github-release",
      count: 0,
    });
    expect(pullsCalls).toEqual([]);
    expect(LocalGitHub.create).toHaveBeenCalledOnce();
  });
});

describe("blobless partial clone initialization", () => {
  test("initializes a blob:none partial clone that LocalGitHub reuses without downloading historical blobs", async () => {
    const historicalFile = path.join(origin, "historical-payload.txt");
    await Bun.write(historicalFile, "historical-blob-payload-".repeat(256));
    await git(origin, "add", "historical-payload.txt");
    await git(origin, "commit", "-m", "feat: add historical payload");
    const historicalBlobSha = await git(
      origin,
      "rev-parse",
      "HEAD:historical-payload.txt",
    );
    await git(origin, "tag", "example-v1.0.0");

    await git(origin, "rm", "historical-payload.txt");
    await git(origin, "commit", "-m", "chore: remove historical payload");

    let promisor = "";
    let partialFilter = "";
    let localObjects = "";
    let fetchedTags = "";
    let historyLog = "";

    onManifestLoaded = async () => {
      promisor = await git(
        clonePath,
        "config",
        "--get",
        "remote.origin.promisor",
      );
      partialFilter = await git(
        clonePath,
        "config",
        "--get",
        "remote.origin.partialclonefilter",
      );
      localObjects = await git(
        clonePath,
        "cat-file",
        "--batch-check=%(objectname) %(objecttype)",
        "--batch-all-objects",
      );
      fetchedTags = await git(clonePath, "tag", "--list");
      historyLog = await git(clonePath, "log", "--name-only", "--oneline");
    };

    expect(await runReleasePlease(options("release-pr"))).toEqual({
      phase: "release-pr",
      count: 0,
    });

    expect(promisor).toBe("true");
    expect(partialFilter).toBe("blob:none");
    expect(localObjects).not.toContain(historicalBlobSha);
    expect(fetchedTags).toContain("example-v1.0.0");
    expect(historyLog).toContain("historical-payload.txt");
  });

  test("initializePartialClone sets origin URL and checks out targetBranch", async () => {
    const targetDir = await mkdtemp(path.join(fixtureRoot, "manual-partial-"));
    const remoteUrl = pathToFileURL(origin).href;
    await initializePartialClone(targetDir, remoteUrl, "main");

    expect(await git(targetDir, "remote", "get-url", "origin")).toBe(remoteUrl);
    expect(await git(targetDir, "rev-parse", "--abbrev-ref", "HEAD")).toBe(
      "main",
    );
    expect(await git(targetDir, "rev-parse", "HEAD")).toBe(initialSha);
  });
});
