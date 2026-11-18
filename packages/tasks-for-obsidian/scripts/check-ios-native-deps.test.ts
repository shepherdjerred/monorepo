import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findNativeBootstrapMessages } from "./check-ios-native-deps.ts";

const repo = path.resolve(import.meta.dirname, "../../..");

async function loadBootstrap() {
  const [packageJson, miseToml, postCloneScript, wrapper, project] =
    await Promise.all([
      Bun.file(
        path.join(repo, "packages/tasks-for-obsidian/package.json"),
      ).text(),
      Bun.file(path.join(repo, ".mise.toml")).text(),
      Bun.file(
        path.join(
          repo,
          "packages/tasks-for-obsidian/ios/ci_scripts/ci_post_clone.sh",
        ),
      ).text(),
      Bun.file(
        path.join(
          repo,
          "packages/tasks-for-obsidian/ios/ci_scripts/mise-native.sh",
        ),
      ).text(),
      Bun.file(
        path.join(repo, "packages/tasks-for-obsidian/ios/project.yml"),
      ).text(),
    ]);
  return {
    packageJson,
    miseToml,
    postCloneScript,
    wrapper,
    wrapperExecutable: true,
    project,
  };
}

describe("native archive bootstrap", () => {
  it("rejects an untracked root tool dependency in the supported project generation entry", async () => {
    const bootstrap = await loadBootstrap();
    expect(
      findNativeBootstrapMessages({
        ...bootstrap,
        packageJson: bootstrap.packageJson.replace(
          "ios/ci_scripts/mise-native.sh exec -- xcodegen",
          "../../bin/mise exec -- xcodegen",
        ),
      }),
    ).toContain(
      "Native project generation must use the tracked pinned Apple bootstrap, without untracked root bin tools.",
    );
  });

  it("rejects a missing release UI dependency even when the unit target retains it", async () => {
    const bootstrap = await loadBootstrap();
    const changed = bootstrap.project.replace(
      "product: TaskNotesFacetUI",
      "product: LegacyServerClient",
    );
    expect(changed).toContain("product: TaskNotesFacetUI");
    expect(
      findNativeBootstrapMessages({ ...bootstrap, project: changed }),
    ).toContain(
      "Native release project must preserve the registered app, widget and shared SwiftUI product.",
    );
  });

  it("validates the actual shared producer and rejects missing pins, unchecked downloads, Rust FFI, and legacy RN bootstrap", async () => {
    const bootstrap = await loadBootstrap();
    expect(findNativeBootstrapMessages(bootstrap)).toEqual([]);
    for (const change of [
      { miseToml: bootstrap.miseToml.replace(/^bun =.*$/mu, "") },
      {
        miseToml: bootstrap.miseToml.replace(
          'os = ["macos"]',
          'os = ["linux"]',
        ),
      },
      {
        postCloneScript: `${bootstrap.postCloneScript}\nBUN_INSTALL_TAG="bun-v1.0.0"`,
      },
      {
        postCloneScript: `${bootstrap.postCloneScript}\ncargo xtask build-xcframework`,
      },
      {
        postCloneScript: bootstrap.postCloneScript.replace(
          "--frozen-lockfile",
          "--linker hoisted",
        ),
      },
      {
        postCloneScript: bootstrap.postCloneScript.replace(
          "export MISE_EXEC_AUTO_INSTALL=false",
          "",
        ),
      },
      { wrapper: bootstrap.wrapper.replace("shasum -a 256 -c", "true") },
      { wrapperExecutable: false },
      {
        project: bootstrap.project.replace(
          "product: TaskNotesFacetUI",
          "product: LegacyServerClient",
        ),
      },
    ]) {
      expect(
        findNativeBootstrapMessages({ ...bootstrap, ...change }).length,
      ).toBeGreaterThan(0);
    }
  });

  it("runs post-clone without a preinstalled mise and generates iOS notices and Xcode project cleanly", async () => {
    const bootstrap = await loadBootstrap();
    const root = await mkdtemp(path.join(tmpdir(), "facet-cloud-bootstrap-"));
    try {
      await mkdir(
        path.join(root, "packages/tasks-for-obsidian/ios/ci_scripts"),
        {
          recursive: true,
        },
      );
      await Bun.write(path.join(root, ".mise.toml"), bootstrap.miseToml);
      const wrapperPath = path.join(
        root,
        "packages/tasks-for-obsidian/ios/ci_scripts/mise-native.sh",
      );
      await Bun.write(
        wrapperPath,
        '#!/bin/bash\nif [ "$1" = exec ] && [ "${MISE_EXEC_AUTO_INSTALL:-}" != false ]; then exit 41; fi\nprintf "%s|%s\\n" "$PWD" "$*" >> "$CI_PRIMARY_REPOSITORY_PATH/calls"\n',
      );
      await chmod(wrapperPath, 0o755);
      const hook = path.join(root, "post-clone.sh");
      await Bun.write(hook, bootstrap.postCloneScript);
      const child = Bun.spawnSync(["/bin/bash", hook], {
        cwd: tmpdir(),
        stdout: "pipe",
        stderr: "pipe",
        env: { PATH: "/usr/bin:/bin", CI_PRIMARY_REPOSITORY_PATH: root },
      });
      expect(child.exitCode, new TextDecoder().decode(child.stderr)).toBe(0);
      const callsText = await Bun.file(path.join(root, "calls")).text();
      expect(callsText.trim().split("\n")).toEqual([
        `${root}|trust ${root}/.mise.toml`,
        `${root}|install --yes bun aqua:yonaskolb/XcodeGen`,
        `${root}|exec -- bun install --frozen-lockfile --ignore-scripts`,
        `${root}|exec -- bun ${root}/packages/tasknotes-macos/scripts/generate-native-notices.ts --ios`,
        `${root}/packages/tasks-for-obsidian/ios|exec -- xcodegen generate`,
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
