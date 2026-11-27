import { describe, expect, test } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";

import {
  changedPathsSince,
  selectImageTargets,
  selectImageTargetsWithReasons,
  type SelectorInputs,
} from "./select-image-targets.ts";
import {
  ALL_IMAGE_TARGETS,
  APPLICATION_IMAGE_TARGETS,
} from "../images/image-targets.ts";
import {
  closureFingerprint,
  closurePackageIds,
  parseJsonc,
  parseLockfile,
  patchedDependencyKey,
  type LockfilePair,
} from "./select-image-targets-lockfile.ts";
import { classifyManifestChange } from "./select-image-targets-manifests.ts";

const REPO_ROOT = new URL("../../..", import.meta.url).pathname;
function selectorInputs(inputs?: SelectorInputs): SelectorInputs {
  return { ...inputs };
}

function select(
  changedPaths: readonly string[],
  inputs?: SelectorInputs,
): Promise<string[]> {
  return selectImageTargets(changedPaths, REPO_ROOT, selectorInputs(inputs));
}

function selectWithReasons(
  changedPaths: readonly string[],
  inputs?: SelectorInputs,
) {
  return selectImageTargetsWithReasons(
    changedPaths,
    REPO_ROOT,
    selectorInputs(inputs),
  );
}

test("rebuilds Temporal for every homelab source shipped in its runtime", async () => {
  const dockerfile = await Bun.file(
    nodePath.join(REPO_ROOT, "packages/temporal/Dockerfile"),
  ).text();
  const runtime = dockerfile
    .split("# Scoped source closure")[1]
    ?.split("# Built artifacts")[0];
  if (runtime === undefined)
    throw new Error("Temporal runtime COPY section is missing");
  const sources = [...runtime.matchAll(/^ {2}(packages\/homelab\/\S+) \\$/gmu)];
  expect(sources.length).toBeGreaterThan(0);
  for (const match of sources) {
    const source = match[1];
    if (source === undefined) throw new Error("Runtime source is missing");
    expect(await select([source]), source).toContain("temporal-worker");
  }
});

test("routes code-review changes to Temporal rather than the Woodpecker config extension", async () => {
  for (const path of [
    "packages/code-review/src/gate.ts",
    "packages/temporal/src/lib/github-app-token.ts",
  ]) {
    const targets = await select([path]);
    expect(targets, path).toContain("temporal-worker");
    expect(targets, path).not.toContain("woodpecker-config-extension");
  }
});

test("rebuilds both consumers of The Storm's public status contract", async () => {
  expect(await select(["packages/the-storm/public-status.json"])).toEqual([
    "infra",
    "storm-forum",
  ]);
});

test("service catalog changes rebuild only the images that copy the catalog", async () => {
  // Ownership itself no longer forces a rebuild: v2 publication reads owners
  // from the catalog document, and an owner with no artifact is built anyway
  // (includeMissingQualifiedImages). services.json still ships inside every
  // image whose Dockerfile copies ops-model.
  expect(await select(["packages/ops-model/services.json"])).toEqual([
    "alert-dashboard",
    "charts",
    "ci-cache",
    "delivery",
    "errors",
    "feeds",
    "flags",
    "golink",
    "mail",
    "temporal-worker",
    "tracker",
    "trmnl-dashboard",
  ]);
  // These install ops-model's manifest but copy none of its source.
  const manifest = await select(["packages/ops-model/package.json"]);
  const source = await select(["packages/ops-model/src/catalog.ts"]);
  for (const target of [
    "arcade",
    "birmel",
    "scout-for-lol",
    "storm-brain",
    "streambot",
  ]) {
    expect(manifest).toContain(target);
    expect(source).not.toContain(target);
  }
  expect(source).toContain("storm-forum");
});

test.each(["json", "ts"])(
  "licensed forum %s policy rebuilds both producer and independent verifier images",
  async (extension) => {
    const targets = await select([
      `packages/ops-model/src/forum-bundle-policy.${extension}`,
    ]);
    expect(targets).toContain("storm-forum");
    expect(targets).toContain("delivery");
    expect(targets).toContain("temporal-worker");
  },
);

test("rebuilds infra for the launcher service's Cargo workspace only", async () => {
  for (const path of [
    "packages/glitter-boys-launcher/Cargo.lock",
    "packages/glitter-boys-launcher/Dockerfile",
    "packages/glitter-boys-launcher/crates/launcher-service/src/main.rs",
  ]) {
    expect(await select([path])).toEqual(["infra"]);
  }
  expect(
    await select(["packages/glitter-boys-launcher/published-release.json"]),
  ).toEqual([]);
});

test("selects tasknotes-server when the baked web client changes", async () => {
  expect(await select(["packages/tasknotes-web/src/app.tsx"])).toEqual([
    "tasknotes-server",
  ]);
});

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

  test("selects Arcade for its native game inputs without an always-on fallback", async () => {
    expect(
      await select(["packages/discord-plays-mario-kart/spaghetti-src/a.patch"]),
    ).toEqual(["arcade"]);
    expect(
      await select(["packages/discord-plays-mario-kart/Dockerfile"]),
    ).toEqual(["arcade"]);
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
      "packages/homelab/src/platform-model.ts",
    ]) {
      expect(await select([path])).toEqual(["infra"]);
    }
    // golink's client build and runtime copy the platform model too.
    expect(await select(["packages/homelab/src/platform-model.json"])).toEqual([
      "golink",
      "infra",
    ]);
  });

  test("rebuilds both registry consumers while keeping homelab image sources scoped", async () => {
    for (const path of [
      "packages/homelab/src/domain-registry.json",
      "packages/homelab/src/domain-registry.ts",
    ]) {
      expect(await select([path])).toEqual(["infra", "temporal-worker"]);
    }
    expect(await select(["packages/homelab/package.json"])).toEqual([
      "temporal-worker",
    ]);
    expect(
      await select(["packages/homelab/src/tofu/cloudflare/main.tf.json"]),
    ).toEqual([]);
  });

  test("rebuilds infra when The Storm's server image inputs change", async () => {
    for (const path of [
      "packages/the-storm/server/Dockerfile",
      "packages/the-storm/server/plugins.json",
      "packages/the-storm/server/owned/plugins/TheStorm/config.yml",
      "packages/the-storm/server/patches/spigot.json",
      "packages/the-storm/plugin/core/src/main/java/Example.java",
      "packages/the-storm/plugin/gradle/libs.versions.toml",
    ]) {
      expect(await select([path])).toEqual(["infra"]);
    }
  });

  test("rebuilds both sides of The Storm's shared recovery protocol", async () => {
    expect(
      await select([
        "packages/the-storm/server/owned/plugins/TheStorm/plot-reconcile.json",
      ]),
    ).toEqual(["infra", "temporal-worker"]);
    expect(await select(["packages/the-storm/package.json"])).toEqual([
      "storm-forum",
      "temporal-worker",
    ]);
  });

  test("rebuilds Temporal for the Storm runtime inputs copied into its image", async () => {
    for (const path of [
      "packages/the-storm/server/archive-progression.py",
      "packages/the-storm/server/restoration-guards.json",
    ]) {
      expect(await select([path])).toEqual(["infra"]);
    }
    expect(
      await select([
        "packages/the-storm/server/owned/plugins/TheStorm/rwf-archive.json",
      ]),
    ).toEqual(["infra", "temporal-worker"]);
    expect(
      await select(["packages/the-storm/maintenance-status.json"]),
    ).toContain("temporal-worker");
    for (const path of [
      "packages/the-storm/plugin/core/src/main/java/Example.java",
      "packages/the-storm/server/owned/plugins/TheStorm/rwf.yml",
      "packages/the-storm/server/patches/spigot.json",
      "packages/the-storm/server/nested/not-copied.py",
    ]) {
      expect(await select([path])).toEqual(["infra"]);
    }
  });

  test("rebuilds infra when the managed flag inventory changes", async () => {
    expect(
      await select(["packages/feature-flags/src/managed-flag-inventory.json"]),
    ).toContain("infra");
  });

  test("leaves images alone for The Storm files outside the image context", async () => {
    for (const path of [
      "packages/the-storm/README.md",
      "packages/the-storm/tests/e2e/boot.test.ts",
    ]) {
      expect(await select([path])).toEqual([]);
    }
  });

  test("selects toolkit's transitive image consumer", async () => {
    expect(await select(["packages/toolkit/src/commands/pr.ts"])).toEqual([
      "temporal-worker",
    ]);
  });

  test("selects only Temporal when its Codex launcher permission producer changes", async () => {
    expect(
      await select(["ci/scripts/images/harden-codex-launcher.ts"]),
    ).toEqual(["temporal-worker"]);
  });

  test("selects only applications for shared application image inputs", async () => {
    for (const path of [
      "ci/application-image-smoke.Dockerfile",
      "ci/scripts/images/application-image-runtime.ts",
      "ci/scripts/images/smoke-app-in-image.ts",
      "ci/scripts/images/complete-bin-links.ts",
      "ci/scripts/images/workspace-manifests.ts",
      ".dockerignore",
      "bunfig.toml",
      "tsconfig.base.json",
    ]) {
      const result = await selectWithReasons([path]);
      expect(result.targets).toEqual(APPLICATION_IMAGE_TARGETS);
      expect(result.targets).not.toContain("infra");
      expect(result.report.targets["birmel"]).toEqual([
        `shared application image input: ${path} (matches ${path})`,
      ]);
    }
  });

  test("selects every image when bake, classification, or selector machinery changes", async () => {
    for (const path of [
      "docker-bake.hcl",
      "ci/scripts/images/bake-images.ts",
      "ci/scripts/images/image-targets.ts",
      "ci/scripts/images/live-version-catalog.ts",
      "ci/scripts/migration-core.ts",
      "packages/woodpecker-config-extension/src/pipeline/lanes/artifacts.ts",
      "ci/scripts/images/production-bake-environment.ts",
      "ci/scripts/selectors/ensure-ancestor.ts",
      "ci/scripts/selectors/select-image-targets.ts",
      "ci/scripts/selectors/select-image-targets-inputs.ts",
      "ci/scripts/selectors/select-image-targets-lockfile.ts",
      "ci/scripts/selectors/select-image-targets-pins.ts",
      "ci/scripts/selectors/select-image-targets-workspaces.ts",
    ]) {
      expect(await select([path])).toEqual(ALL_IMAGE_TARGETS);
    }
  });

  test("does not rebuild images for orchestration-only inputs", async () => {
    for (const path of ["ci/scripts/upload-pipeline.sh", "turbo.json"]) {
      expect(await select([path])).toEqual([]);
    }
  });

  test("fails open for an unreadable root manifest and bounds the scripts manifest", async () => {
    expect(await select(["package.json"])).toEqual(ALL_IMAGE_TARGETS);
    // scripts/package.json reaches only installs whose closure depends on it.
    expect(await select(["scripts/package.json"])).toEqual([
      "scout-for-lol",
      "temporal-worker",
    ]);
  });

  test("attributes a workspace package.json to its closure, not ALL images", async () => {
    // resume is in no image closure — its manifest alone builds nothing.
    expect(await select(["packages/resume/package.json"])).toEqual([]);
    expect(await select(["packages/birmel/package.json"])).toEqual(["birmel"]);
  });

  test("selects Scout and Temporal's build for Scout's shared base TypeScript config", async () => {
    expect(await select(["packages/scout-for-lol/tsconfig.base.json"])).toEqual(
      ["scout-for-lol", "temporal-worker"],
    );
  });

  test("selects Scout for its contract-hash implementation with an exact reason", async () => {
    const path = "packages/scout-for-lol/scripts/contract-hash.ts";
    const result = await selectWithReasons([path]);
    expect(result.targets).toEqual(["scout-for-lol"]);
    expect(result.report.targets["scout-for-lol"]).toEqual([
      `configured extra input: ${path} (matches ${path})`,
    ]);
  });

  test("selects nothing for unrelated documentation", async () => {
    expect(await select(["README.md"])).toEqual([]);
  });
});

describe("inputs outside workspace closures", () => {
  test("rebuilds infra when a contract The Storm's plugin compiles against changes", async () => {
    for (const path of [
      "packages/storm-brain/contracts/companion-chat.json",
      "packages/storm-brain/contracts/content-moderation.json",
      "packages/mc-harness/src/protocol/evidence-contract.json",
    ]) {
      expect(await select([path]), path).toContain("infra");
    }
  });

  test("rebuilds Temporal for the repository sources and pins its Dockerfile copies", async () => {
    for (const path of [
      "scripts/lib/run.ts",
      "packages/the-storm/promotion/README.md",
      ".mise.toml",
      "mise.lock",
    ]) {
      expect(await select([path]), path).toEqual(["temporal-worker"]);
    }
  });

  test("rebuilds Arcade for the Pokemon agent knowledge it ships", async () => {
    for (const path of [
      "packages/discord-plays-pokemon/AGENTS.md",
      "packages/discord-plays-pokemon/knowledge/README.md",
      "packages/discord-plays-pokemon/.agents/skills/README.md",
    ]) {
      expect(await select([path]), path).toEqual(["arcade"]);
    }
  });

  test("does not rebuild images for publication plumbing", async () => {
    // None of these reaches an image's bytes, and Delivery keeps the original
    // of any rebuilt candidate whose content did not change.
    for (const path of [
      "ci/scripts/images/bake-retry.ts",
      "ci/scripts/images/dockerhub-access.ts",
      "ci/scripts/reporting/buildkit-env.ts",
      "ci/scripts/reporting/dockerhub-env.ts",
    ]) {
      expect(await select([path]), path).toEqual([]);
    }
    // Temporal's runtime copies all of scripts/lib, so only it rebuilds.
    for (const path of [
      "scripts/lib/ci/ci-handoff.ts",
      "scripts/lib/ci/published-image-release.ts",
      "scripts/lib/dockerhub-credentials.ts",
      "scripts/lib/image-pin-catalog.ts",
    ]) {
      expect(await select([path]), path).toEqual(["temporal-worker"]);
    }
    // Registry visibility rebuilds only the images that copy version-catalog.
    expect(
      await select(["packages/version-catalog/src/image-registry.json"]),
    ).toEqual(await select(["packages/version-catalog/src/catalog.json"]));
    expect(
      await select(["packages/version-catalog/src/image-registry.json"]),
    ).not.toContain("birmel");
    // The CI toolchain refresh lane rebuilds only the extension it lives in.
    expect(
      await select([
        "packages/woodpecker-config-extension/src/pipeline/lanes/ci-images.ts",
      ]),
    ).toEqual(["woodpecker-config-extension"]);
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

  test("an added workspace selects only the closures that depend on it", async () => {
    // packages/b is in no image closure; llm-models is in several.
    const unused = { ...basePkg, workspaces: ["packages/a", "packages/b"] };
    expect(await select(["package.json"], pair(unused))).toEqual([]);
    const shared = {
      ...basePkg,
      workspaces: ["packages/llm-models", "packages/a"],
    };
    const { targets, report } = await selectWithReasons(
      ["package.json"],
      pair(shared),
    );
    expect(targets).toEqual(await select(["packages/llm-models/package.json"]));
    expect(report.targets["scout-for-lol"]).toEqual([
      "new workspace in package.json: packages/llm-models",
    ]);
  });

  test("an added workspace no manifests stage copies stays global", async () => {
    // workspace-manifests.ts would fail to read its manifest in every
    // application image, so every application image must build.
    const head = {
      ...basePkg,
      workspaces: ["packages/a", "packages/homelab/src/new-tool"],
    };
    const { targets, report } = await selectWithReasons(
      ["package.json"],
      pair(head),
    );
    expect(targets).toEqual(ALL_IMAGE_TARGETS);
    expect(report.globalReason).toBe(
      "package.json adds workspace packages/homelab/src/new-tool, whose manifest no application manifests stage copies",
    );
  });

  test("a removed, reordered, or duplicated workspace stays global", async () => {
    const base = { ...basePkg, workspaces: ["packages/a", "packages/c"] };
    for (const workspaces of [
      [],
      ["packages/c", "packages/a", "packages/b"],
      ["packages/a", "packages/c", "packages/a"],
    ]) {
      expect(
        await select(["package.json"], {
          rootPackageJson: {
            base: JSON.stringify(base),
            head: JSON.stringify({ ...basePkg, workspaces }),
          },
        }),
        JSON.stringify(workspaces),
      ).toEqual(ALL_IMAGE_TARGETS);
    }
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

  test("scripts/package.json selects only the installs that project it", async () => {
    const scripts = (head: object): SelectorInputs => ({
      scriptsPackageJson: {
        base: JSON.stringify(basePkg),
        head: JSON.stringify(head),
      },
    });
    const tooling = { ...basePkg, devDependencies: { turbo: "2.0.0" } };
    expect(await select(["scripts/package.json"], scripts(tooling))).toEqual(
      [],
    );
    const dependency = { ...basePkg, dependencies: { zod: "4.0.0" } };
    expect(await select(["scripts/package.json"], scripts(dependency))).toEqual(
      ["scout-for-lol", "temporal-worker"],
    );
  });

  test("classifyManifestChange treats identical content as attributable", () => {
    const text = JSON.stringify(basePkg);
    expect(classifyManifestChange({ base: text, head: text })).toEqual({
      global: false,
      addedWorkspaces: [],
    });
  });
});

describe("patch attribution", () => {
  // These run against the REAL repo manifest + lockfile: patch keys are
  // version-exact, so a patch whose pinned version nothing resolves anymore
  // (a stale patch) correctly selects no image.
  test("a patch selects only the images whose closure resolves it", async () => {
    // node-datachannel reaches exactly the voice/streaming images and
    // nothing else, which is the attribution property: a patch must not
    // rebuild images that never resolve the patched package.
    expect(
      await select([
        "patches/@lng2004%2Fnode-datachannel@0.32.3-20260815.5.patch",
      ]),
    ).toEqual(["arcade", "streambot"]);
  });

  test("a patch resolved through several packages selects only those images", async () => {
    expect(
      await select([
        "patches/@lng2004%2Fnode-datachannel@0.32.3-20260815.5.patch",
      ]),
    ).toEqual(["arcade", "streambot"]);
  });

  test("a patch for a dep outside every image closure selects nothing", async () => {
    expect(
      await select(["patches/@astrojs%2Finternal-helpers@0.13.2.patch"]),
    ).toEqual([]);
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

  test("closurePackageIds resolves deps of a package that exists only nested", () => {
    // bun can place a package only under its dependent ("x/@s/p"), with that
    // package's own deps nested beneath it ("x/@s/p/q") or under an ancestor
    // ("x/r"). Lookup walks the full key path up, like node_modules.
    const lock = parseLockfile(
      JSON.stringify({
        lockfileVersion: 1,
        workspaces: {
          "": { name: "root" },
          "packages/a": { name: "a", dependencies: { x: "^1" } },
        },
        packages: {
          x: ["x@1.0.0", "", { dependencies: { "@s/p": "^1" } }, "sha512-x"],
          "x/@s/p": [
            "@s/p@1.0.0",
            "",
            { dependencies: { q: "^1", r: "^1", t: "^1" } },
            "sha512-p",
          ],
          "x/@s/p/q": ["q@1.0.0", "", {}, "sha512-q"],
          "x/r": ["r@2.0.0", "", {}, "sha512-r-under-x"],
          r: ["r@1.0.0", "", {}, "sha512-r"],
          t: ["t@1.0.0", "", {}, "sha512-t"],
        },
      }),
    );
    const ids = closurePackageIds(["packages/a"], lock);
    expect(ids).not.toBeNull();
    if (ids === null) throw new Error("unreachable");
    expect([...ids].sort()).toEqual([
      "@s/p@1.0.0",
      "a",
      "q@1.0.0",
      "r@2.0.0",
      "t@1.0.0",
      "x@1.0.0",
    ]);
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
    const { targets, report } = await selectWithReasons([
      "packages/tasknotes-server/src/index.ts",
    ]);
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

  test("records every matching path instead of hiding later causes", async () => {
    const { report } = await selectWithReasons([
      "packages/tasknotes-server/src/index.ts",
      "packages/tasknotes-server/src/routes.ts",
    ]);
    expect(report.targets["tasknotes-server"]).toEqual([
      "workspace closure: packages/tasknotes-server/src/index.ts under packages/tasknotes-server/",
      "workspace closure: packages/tasknotes-server/src/routes.ts under packages/tasknotes-server/",
    ]);
  });

  test("a configured extra input records its prefix", async () => {
    const { report } = await selectWithReasons([
      "packages/homelab/src/cdk8s/scripts/generate-caddyfile.ts",
    ]);
    expect(report.mode).toBe("selected");
    const reasons = report.targets["infra"];
    if (reasons === undefined) throw new Error("infra should be selected");
    expect(reasons.join("\n")).toContain("configured extra input");
  });

  test("a global image input flips to ALL with the trigger named", async () => {
    const { targets, report } = await selectWithReasons(["docker-bake.hcl"]);
    expect(targets).toEqual(ALL_IMAGE_TARGETS);
    expect(report.mode).toBe("all");
    expect(report.globalReason).toContain("docker-bake.hcl");
    expect(Object.keys(report.targets).sort()).toEqual(ALL_IMAGE_TARGETS);
    for (const reasons of Object.values(report.targets)) {
      expect(reasons).toEqual([report.globalReason ?? ""]);
    }
  });

  test("a lockfile fail-open reports the failure as the global reason", async () => {
    const { targets, report } = await selectWithReasons(["bun.lock"]);
    expect(targets).toEqual(ALL_IMAGE_TARGETS);
    expect(report.mode).toBe("all");
    expect(report.globalReason).toContain("lockfile attribution failed");
  });

  test("an unselecting change yields an empty report", async () => {
    const { targets, report } = await selectWithReasons(["README.md"]);
    expect(targets).toEqual([]);
    expect(report.mode).toBe("selected");
    expect(report.targets).toEqual({});
  });

  test("the wrapper returns exactly the reasoned targets", async () => {
    const paths = ["packages/llm-models/src/models.ts"];
    const wrapped = await select(paths);
    const { targets } = await selectWithReasons(paths);
    expect(wrapped).toEqual(targets);
  });
});
