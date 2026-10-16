import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Manifest } from "release-please";
import { GitHubApi } from "release-please/build/src/github-api.js";
import { LocalGitHub } from "release-please/build/src/local-github.js";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { runReleasePlease, type ReleasePleasePhase } from "./runner.ts";

async function git(cwd: string, ...args: string[]): Promise<string> {
  const child = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) throw new Error(`Fixture git failed: ${stderr}`);
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
let movementStage: MovementStage | undefined;
let loadedManifest: Manifest | undefined;

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
    targetBranch: "main",
    resolveTarget,
  };
}

beforeEach(async () => {
  fixtureRoot = await mkdtemp(path.join(tmpdir(), "release-target-"));
  origin = path.join(fixtureRoot, "origin");
  clonePath = "";
  advanceDuringClone = false;
  movementStage = undefined;
  loadedManifest = undefined;
  resolveTarget.mockClear();
  await mkdir(origin);
  await git(origin, "init", "-b", "main");
  await git(origin, "config", "user.name", "Release fixture");
  await git(origin, "config", "user.email", "fixture@example.invalid");
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

  vi.spyOn(LocalGitHub, "create").mockImplementation(async (configuration) => {
    const localPath = configuration.localRepoPath;
    if (localPath === undefined) throw new Error("Missing temporary clone");
    clonePath = localPath;
    await git(fixtureRoot, "clone", "--no-hardlinks", "--", origin, localPath);
    if (advanceDuringClone) await advanceMain();
    const repository = {
      owner: "shepherdjerred",
      repo: "monorepo",
      defaultBranch: "main",
    };
    const api = await GitHubApi.create({ ...repository, token: "fixture" });
    return new LocalGitHub(repository, api, localPath);
  });
  vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
    Response.json({ object: { sha: await git(origin, "rev-parse", "HEAD") } }),
  );
  const fromManifest = Manifest.fromManifest;
  vi.spyOn(Manifest, "fromManifest").mockImplementation(async (...args) => {
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

test.each(phases)(
  "%s resolves eligibility after a merge during cloning and fetches the new commit",
  async (phase) => {
    advanceDuringClone = true;
    expect(await runReleasePlease(options(phase))).toEqual({ phase, count: 0 });
    expect(resolveTarget).toHaveBeenCalledOnce();
    expect(
      loadedManifest?.releasedVersions["packages/example"]?.toString(),
    ).toBe("1.1.0");
    expect(
      loadedManifest?.repositoryConfig["packages/example"]?.excludePaths,
    ).toEqual(["packages/example/"]);
    expect(await Bun.file(path.join(clonePath, ".git/config")).exists()).toBe(
      false,
    );
  },
);

const guardCases = phases.flatMap((phase) =>
  stages.map((stage) => ({ phase, stage })),
);
test.each(guardCases)(
  "$phase rejects main movement at $stage and cleans up its clone",
  async ({ phase, stage }) => {
    movementStage = stage;
    const messages = {
      resolve: "before release-please loaded its manifest",
      manifest: "while release-please loaded its manifest",
      mutation: "during release-please",
    };
    await expect(runReleasePlease(options(phase))).rejects.toThrow(
      messages[stage],
    );
    if (stage === "mutation") {
      const method =
        phase === "release-pr" ? "createPullRequests" : "createReleases";
      expect(Manifest.prototype[method]).toHaveBeenCalledOnce();
    } else {
      expect(Manifest.prototype.createPullRequests).not.toHaveBeenCalled();
      expect(Manifest.prototype.createReleases).not.toHaveBeenCalled();
    }
    expect(await Bun.file(path.join(clonePath, ".git/config")).exists()).toBe(
      false,
    );
  },
);
