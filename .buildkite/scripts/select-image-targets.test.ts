import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";

import {
  ALL_IMAGE_TARGETS,
  changedPathsSince,
  selectImageTargets,
  selectImageTargetsWithReasons,
  type SelectorInputs,
} from "./select-image-targets.ts";
import {
  closureFingerprint,
  closurePackageIds,
  manifestChangeIsGlobal,
  parseJsonc,
  parseLockfile,
  patchedDependencyKey,
  type LockfilePair,
} from "./select-image-targets-lockfile.ts";

const REPO_ROOT = new URL("../..", import.meta.url).pathname;

function select(
  changedPaths: readonly string[],
  inputs?: SelectorInputs,
): Promise<string[]> {
  return selectImageTargets(changedPaths, REPO_ROOT, inputs);
}

describe("selectImageTargets", () => {
  test("selects a standalone application image", async () => {
    expect(await select(["packages/tasknotes-server/src/index.ts"])).toEqual([
      "tasknotes-server",
    ]);
  });

  test("selects consumers of a shared workspace dependency", async () => {
    const targets = await select(["packages/llm-models/src/models.ts"]);
    expect(targets).toContain("scout-for-lol");
    expect(targets).toContain("temporal-worker");
  });

  test("selects nested game families without an always-on fallback", async () => {
    expect(
      await select([
        "packages/discord-plays-pokemon/wasm-src/patches/example.patch",
      ]),
    ).toEqual(["discord-plays-pokemon"]);
    expect(
      await select(["packages/discord-plays-mario-kart/wasm-src/src/main.cpp"]),
    ).toEqual(["discord-plays-mario-kart"]);
  });

  test("groups the homelab image family", async () => {
    expect(
      await select(["packages/homelab/images/caddy-s3proxy/Dockerfile"]),
    ).toEqual(["infra"]);
  });

  test("rebuilds infra when the generated Caddyfile changes", async () => {
    for (const path of [
      "packages/homelab/src/cdk8s/scripts/generate-caddyfile.ts",
      "packages/homelab/src/cdk8s/src/misc/common.ts",
      "packages/homelab/src/cdk8s/src/misc/s3-static-site.ts",
      "packages/homelab/src/cdk8s/src/resources/s3-static-sites/sites.ts",
    ]) {
      expect(await select([path])).toEqual(["infra"]);
    }
  });

  test("selects explicit Docker inputs outside workspace dependencies", async () => {
    expect(await select(["packages/toolkit/src/commands/pr.ts"])).toEqual([
      "temporal-worker",
    ]);
  });

  test("selects every image for shared build inputs", async () => {
    expect(await select([".buildkite/pipeline.yml"])).toEqual(
      ALL_IMAGE_TARGETS,
    );
    expect(await select([".mise.toml"])).toEqual(ALL_IMAGE_TARGETS);
    expect(await select(["turbo.json"])).toEqual(ALL_IMAGE_TARGETS);
    expect(await select(["tsconfig.base.json"])).toEqual(ALL_IMAGE_TARGETS);
    // Root manifests with NO FilePair provided fail open to ALL.
    expect(await select(["package.json"])).toEqual(ALL_IMAGE_TARGETS);
    expect(await select(["scripts/package.json"])).toEqual(ALL_IMAGE_TARGETS);
    // Image-shaping CI scripts stay global; other CI scripts do not.
    expect(await select([".buildkite/scripts/bake-images.sh"])).toEqual(
      ALL_IMAGE_TARGETS,
    );
    expect(await select([".buildkite/scripts/upload-pipeline.sh"])).toEqual([]);
  });

  test("attributes a workspace package.json to its closure, not ALL images", async () => {
    // resume is in no image closure — its manifest alone builds nothing.
    expect(await select(["packages/resume/package.json"])).toEqual([]);
    expect(await select(["packages/birmel/package.json"])).toEqual(["birmel"]);
  });

  test("selects Scout for its shared base TypeScript config", async () => {
    expect(await select(["packages/scout-for-lol/tsconfig.base.json"])).toEqual(
      ["scout-for-lol"],
    );
  });

  test("selects nothing for unrelated documentation", async () => {
    expect(await select(["packages/docs/guides/example.md"])).toEqual([]);
  });
});

describe("parseJsonc", () => {
  test("handles comments and trailing commas without touching strings", () => {
    const parsed = parseJsonc(
      `{
        // line comment
        "list": [ "a, ]", "b", /* block */ ],
        "nested": { "k": "v", },
      }`,
    );
    expect(parsed).toEqual({ list: ["a, ]", "b"], nested: { k: "v" } });
  });
});

describe("lockfile attribution", () => {
  const syntheticLock = JSON.stringify({
    lockfileVersion: 1,
    configVersion: 1,
    workspaces: {
      "": { name: "root", devDependencies: { lint: "^1" } },
      "packages/a": { name: "a", dependencies: { x: "^1" } },
    },
    packages: {
      lint: ["lint@1.0.0", "", {}, "sha512-lint"],
      x: ["x@1.0.0", "", { dependencies: { y: "^2" } }, "sha512-x"],
      y: ["y@2.0.0", "", {}, "sha512-y"],
      "x/y": ["y@2.5.0", "", {}, "sha512-y-nested"],
    },
  });

  test("fingerprints follow nested (parent-name) resolution", () => {
    const lock = parseLockfile(syntheticLock);
    const fp = closureFingerprint(["packages/a"], lock);
    expect(fp).toContain("x/y=y@2.5.0#sha512-y-nested");
    expect(fp).not.toContain("lint@1.0.0");
  });

  test("a change outside the closure leaves the fingerprint alone", () => {
    const bumpedLint = syntheticLock.replace("lint@1.0.0", "lint@1.1.0");
    const before = closureFingerprint(
      ["packages/a"],
      parseLockfile(syntheticLock),
    );
    const after = closureFingerprint(["packages/a"], parseLockfile(bumpedLint));
    expect(after).toEqual(before);
  });

  test("a transitive bump inside the closure changes the fingerprint", () => {
    const bumped = syntheticLock.replace("sha512-y-nested", "sha512-y-next");
    const before = closureFingerprint(
      ["packages/a"],
      parseLockfile(syntheticLock),
    );
    const after = closureFingerprint(["packages/a"], parseLockfile(bumped));
    expect(after).not.toEqual(before);
  });

  test("a lockfile format bump flips the fingerprint even with no dep change", () => {
    // configVersion/lockfileVersion carry no dep spec, but a bun format bump can
    // change resolution semantics, so it must fail selection open to all targets
    // rather than leave every closure fingerprint equal (which selects none).
    const before = closureFingerprint(
      ["packages/a"],
      parseLockfile(syntheticLock),
    );
    const configBumped = syntheticLock.replace(
      '"configVersion":1',
      '"configVersion":2',
    );
    expect(configBumped).not.toEqual(syntheticLock);
    expect(
      closureFingerprint(["packages/a"], parseLockfile(configBumped)),
    ).not.toEqual(before);
    const lockBumped = syntheticLock.replace(
      '"lockfileVersion":1',
      '"lockfileVersion":2',
    );
    expect(lockBumped).not.toEqual(syntheticLock);
    expect(
      closureFingerprint(["packages/a"], parseLockfile(lockBumped)),
    ).not.toEqual(before);
  });

  test("unknown lockfile keys are rejected (fail-open trigger)", () => {
    expect(() =>
      parseLockfile(JSON.stringify({ lockfileVersion: 1, mystery: {} })),
    ).toThrow("unknown lockfile key");
  });

  test("the real lockfile parses and every image closure fingerprints", async () => {
    // Schema-drift canary: if bun changes the lock format, THIS fails loudly
    // in CI instead of the runtime selector failing open on every build.
    const real = await Bun.file(`${REPO_ROOT}/bun.lock`).text();
    const identical: LockfilePair = { base: real, head: real };
    expect(await select(["bun.lock"], { lockfiles: identical })).toEqual([]);
  });

  test("a real direct-dep resolution change selects only its closures", async () => {
    const real = await Bun.file(`${REPO_ROOT}/bun.lock`).text();
    // Mutate the resolved discord.js entry's integrity — birmel's closure
    // contains it; resume/sjer.red-class targets must stay unselected.
    const entry =
      /"discord\.js": \["discord\.js@[^"]+", [^\n]*"(sha512-[^"]+)"\]/;
    const match = entry.exec(real);
    expect(match).not.toBeNull();
    if (match === null) throw new Error("unreachable");
    const mutated = real.replace(match[1] ?? "", "sha512-mutated");
    const targets = await select(["bun.lock"], {
      lockfiles: { base: real, head: mutated },
    });
    expect(targets).toContain("birmel");
    expect(targets).not.toEqual(ALL_IMAGE_TARGETS);
  });

  test("embedded-artifact closures join lockfile attribution", async () => {
    // temporal-worker bakes the compiled toolkit CLI, so a resolution change
    // reachable only through toolkit's closure (asciinema-player is a
    // toolkit-only dep) must rebuild temporal-worker even though toolkit is
    // not a runtime workspace dep of the temporal owner.
    const real = await Bun.file(`${REPO_ROOT}/bun.lock`).text();
    const entry =
      /"asciinema-player": \["asciinema-player@[^"]+", [^\n]*"(sha512-[^"]+)"\]/;
    const match = entry.exec(real);
    expect(match).not.toBeNull();
    if (match === null) throw new Error("unreachable");
    const mutated = real.replace(match[1] ?? "", "sha512-mutated");
    const targets = await select(["bun.lock"], {
      lockfiles: { base: real, head: mutated },
    });
    expect(targets).toContain("temporal-worker");
    expect(targets).not.toEqual(ALL_IMAGE_TARGETS);
  });

  test("fails open to ALL on an unreadable base or malformed head", async () => {
    const real = await Bun.file(`${REPO_ROOT}/bun.lock`).text();
    expect(
      await select(["bun.lock"], { lockfiles: { base: null, head: real } }),
    ).toEqual(ALL_IMAGE_TARGETS);
    expect(
      await select(["bun.lock"], {
        lockfiles: { base: real, head: "{ not json" },
      }),
    ).toEqual(ALL_IMAGE_TARGETS);
    expect(await select(["bun.lock"])).toEqual(ALL_IMAGE_TARGETS);
  });
});

describe("root manifest attribution", () => {
  const basePkg = {
    name: "root",
    workspaces: ["packages/a"],
    devDependencies: { turbo: "1.0.0", prettier: "3.0.0" },
    scripts: { verify: "turbo run build" },
    overrides: { axios: "1.0.0" },
  };
  const pair = (head: object): SelectorInputs => ({
    rootPackageJson: {
      base: JSON.stringify(basePkg),
      head: JSON.stringify(head),
    },
  });

  test("a devDependencies-only bump selects nothing", async () => {
    const head = {
      ...basePkg,
      devDependencies: { turbo: "2.0.0", prettier: "3.0.0" },
    };
    expect(await select(["package.json"], pair(head))).toEqual([]);
  });

  test("a scripts-only change selects nothing", async () => {
    const head = { ...basePkg, scripts: { verify: "turbo run build test" } };
    expect(await select(["package.json"], pair(head))).toEqual([]);
  });

  test("an overrides change stays global", async () => {
    const head = { ...basePkg, overrides: { axios: "1.1.0" } };
    expect(await select(["package.json"], pair(head))).toEqual(
      ALL_IMAGE_TARGETS,
    );
  });

  test("a workspaces change stays global", async () => {
    const head = { ...basePkg, workspaces: ["packages/a", "packages/b"] };
    expect(await select(["package.json"], pair(head))).toEqual(
      ALL_IMAGE_TARGETS,
    );
  });

  test("a new top-level key stays global", async () => {
    const head = { ...basePkg, patchedDependencies: {} };
    expect(await select(["package.json"], pair(head))).toEqual(
      ALL_IMAGE_TARGETS,
    );
  });

  test("fails open on malformed content or a missing base", async () => {
    expect(
      await select(["package.json"], {
        rootPackageJson: { base: JSON.stringify(basePkg), head: "{ not json" },
      }),
    ).toEqual(ALL_IMAGE_TARGETS);
    expect(
      await select(["package.json"], {
        rootPackageJson: { base: null, head: JSON.stringify(basePkg) },
      }),
    ).toEqual(ALL_IMAGE_TARGETS);
  });

  test("scripts/package.json gets the same treatment", async () => {
    const head = { ...basePkg, devDependencies: { turbo: "2.0.0" } };
    expect(
      await select(["scripts/package.json"], {
        scriptsPackageJson: {
          base: JSON.stringify(basePkg),
          head: JSON.stringify(head),
        },
      }),
    ).toEqual([]);
  });

  test("manifestChangeIsGlobal treats identical content as attributable", () => {
    const text = JSON.stringify(basePkg);
    expect(manifestChangeIsGlobal({ base: text, head: text })).toBe(false);
  });
});

describe("patch attribution", () => {
  // These run against the REAL repo manifest + lockfile: patch keys are
  // version-exact, so a patch whose pinned version nothing resolves anymore
  // (a stale patch) correctly selects no image.
  test("a patch for a dep resolved in one closure selects only that image", async () => {
    expect(
      await select(["patches/discord-player-youtubei@2.0.0.patch"]),
    ).toEqual(["birmel"]);
  });

  test("a patch resolved through several scout packages selects only scout", async () => {
    // twisted@1.82.0 is the live resolution across scout's closure (backend,
    // data), so its patch attributes to exactly the scout image. (Stale
    // patches — keys no closure resolves — can no longer exist:
    // scripts/check-patched-deps.ts fails verify on them.)
    expect(await select(["patches/twisted@1.82.0.patch"])).toEqual([
      "scout-for-lol",
    ]);
  });

  test("a patch for a dep outside every image closure selects nothing", async () => {
    expect(await select(["patches/react-native-sound@0.13.0.patch"])).toEqual(
      [],
    );
  });

  test("a patch file with no patchedDependencies entry fails open", async () => {
    expect(await select(["patches/unknown@9.9.9.patch"])).toEqual(
      ALL_IMAGE_TARGETS,
    );
  });

  test("patchedDependencyKey resolves via the manifest mapping", () => {
    const manifest = JSON.stringify({
      patchedDependencies: { "satori@0.18.3": "patches/satori@0.18.3.patch" },
    });
    expect(patchedDependencyKey("patches/satori@0.18.3.patch", manifest)).toBe(
      "satori@0.18.3",
    );
    expect(patchedDependencyKey("patches/other.patch", manifest)).toBeNull();
    expect(
      patchedDependencyKey("patches/satori@0.18.3.patch", "{ nope"),
    ).toBeNull();
  });

  test("closurePackageIds walks nested resolution and skips other closures", () => {
    const lock = parseLockfile(
      JSON.stringify({
        lockfileVersion: 1,
        workspaces: {
          "": { name: "root", devDependencies: { lint: "^1" } },
          "packages/a": { name: "a", dependencies: { x: "^1" } },
        },
        packages: {
          lint: ["lint@1.0.0", "", {}, "sha512-lint"],
          x: ["x@1.0.0", "", { dependencies: { y: "^2" } }, "sha512-x"],
          y: ["y@2.0.0", "", {}, "sha512-y"],
          "x/y": ["y@2.5.0", "", {}, "sha512-y-nested"],
        },
      }),
    );
    const ids = closurePackageIds(["packages/a"], lock);
    expect(ids).not.toBeNull();
    if (ids === null) throw new Error("unreachable");
    expect(ids.has("x@1.0.0")).toBe(true);
    // The nested (parent-scoped) resolution wins: y is 2.5.0 under x.
    expect(ids.has("y@2.5.0")).toBe(true);
    expect(ids.has("y@2.0.0")).toBe(false);
    expect(ids.has("lint@1.0.0")).toBe(false);
    expect(closurePackageIds(["packages/missing"], lock)).toBeNull();
  });
});

function runGit(repoRoot: string, args: readonly string[]): void {
  const result = Bun.spawnSync(["git", ...args], {
    cwd: repoRoot,
    stderr: "pipe",
    stdout: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(new TextDecoder().decode(result.stderr));
  }
}

describe("changedPathsSince", () => {
  test("reports both sides of a rename so the source image is rebuilt", async () => {
    const fixture = await mkdtemp(nodePath.join(tmpdir(), "ci-image-rename-"));
    try {
      runGit(fixture, ["init", "-q"]);
      runGit(fixture, ["config", "user.email", "ci-selector@example.invalid"]);
      runGit(fixture, ["config", "user.name", "CI selector test"]);
      await Bun.write(`${fixture}/source.ts`, "source\n");
      runGit(fixture, ["add", "source.ts"]);
      runGit(fixture, ["commit", "-qm", "baseline"]);
      const baseResult = Bun.spawnSync(["git", "rev-parse", "HEAD"], {
        cwd: fixture,
        stdout: "pipe",
      });
      const base = new TextDecoder().decode(baseResult.stdout).trim();
      await mkdir(`${fixture}/packages/docs`, { recursive: true });
      runGit(fixture, ["mv", "source.ts", "packages/docs/source.ts"]);
      runGit(fixture, ["commit", "-qm", "rename"]);

      expect(await changedPathsSince(base, fixture)).toEqual([
        "packages/docs/source.ts",
        "source.ts",
      ]);
    } finally {
      await rm(fixture, { force: true, recursive: true });
    }
  });
});

describe("selection reasons", () => {
  test("a closure hit records the matching path and directory", async () => {
    const { targets, report } = await selectImageTargetsWithReasons(
      ["packages/tasknotes-server/src/index.ts"],
      REPO_ROOT,
    );
    expect(targets).toEqual(["tasknotes-server"]);
    expect(report.mode).toBe("selected");
    expect(report.globalReason).toBeNull();
    expect(report.changedPaths).toEqual([
      "packages/tasknotes-server/src/index.ts",
    ]);
    expect(report.targets["tasknotes-server"]).toEqual([
      "workspace closure: packages/tasknotes-server/src/index.ts under packages/tasknotes-server/",
    ]);
  });

  test("a configured extra input records its prefix", async () => {
    const { report } = await selectImageTargetsWithReasons(
      ["packages/homelab/src/cdk8s/scripts/generate-caddyfile.ts"],
      REPO_ROOT,
    );
    expect(report.mode).toBe("selected");
    const reasons = report.targets["infra"];
    if (reasons === undefined) throw new Error("infra should be selected");
    expect(reasons.join("\n")).toContain("configured extra input");
  });

  test("a global image input flips to ALL with the trigger named", async () => {
    const { targets, report } = await selectImageTargetsWithReasons(
      ["docker-bake.hcl"],
      REPO_ROOT,
    );
    expect(targets).toEqual(ALL_IMAGE_TARGETS);
    expect(report.mode).toBe("all");
    expect(report.globalReason).toContain("docker-bake.hcl");
    expect(Object.keys(report.targets).sort()).toEqual(ALL_IMAGE_TARGETS);
    for (const reasons of Object.values(report.targets)) {
      expect(reasons).toEqual([report.globalReason ?? ""]);
    }
  });

  test("a lockfile fail-open reports the failure as the global reason", async () => {
    const { targets, report } = await selectImageTargetsWithReasons(
      ["bun.lock"],
      REPO_ROOT,
    );
    expect(targets).toEqual(ALL_IMAGE_TARGETS);
    expect(report.mode).toBe("all");
    expect(report.globalReason).toContain("lockfile attribution failed");
  });

  test("an unselecting change yields an empty report", async () => {
    const { targets, report } = await selectImageTargetsWithReasons(
      ["packages/docs/logs/example.md"],
      REPO_ROOT,
    );
    expect(targets).toEqual([]);
    expect(report.mode).toBe("selected");
    expect(report.targets).toEqual({});
  });

  test("the wrapper returns exactly the reasoned targets", async () => {
    const paths = ["packages/llm-models/src/models.ts"];
    const wrapped = await select(paths);
    const { targets } = await selectImageTargetsWithReasons(paths, REPO_ROOT);
    expect(wrapped).toEqual(targets);
  });
});
