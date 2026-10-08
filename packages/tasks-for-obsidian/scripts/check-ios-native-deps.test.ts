import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  findNativeBootstrapMessages,
  findMissingIosPodspecMessages,
  findMissingNativePeerDependencyMessages,
} from "./check-ios-native-deps.ts";

describe("check-ios-native-deps", () => {
  it("requires native peer dependencies to be declared by the app", () => {
    const appPackageJson = {
      dependencies: {
        "react-native": "0.85.3",
        "react-native-reanimated": "^4.3.0",
      },
    };
    const installed = new Map([
      [
        "react-native-reanimated",
        {
          peerDependencies: {
            "react-native": "0.81 - 0.85",
            "react-native-worklets": "0.8.x",
          },
        },
      ],
      ["react-native", {}],
    ]);

    expect(
      findMissingNativePeerDependencyMessages(appPackageJson, installed),
    ).toEqual([
      "react-native-reanimated requires react-native-worklets; add react-native-worklets to dependencies so React Native autolinking and CocoaPods can see it in Xcode Cloud.",
    ]);
  });

  it("accepts declared native peer dependencies", () => {
    const appPackageJson = {
      dependencies: {
        "react-native": "0.85.3",
        "react-native-reanimated": "^4.3.0",
        "react-native-worklets": "^0.8.1",
      },
    };
    const installed = new Map([
      [
        "react-native-reanimated",
        {
          peerDependencies: {
            "react-native": "0.81 - 0.85",
            "react-native-worklets": "0.8.x",
          },
        },
      ],
      ["react-native", {}],
      ["react-native-worklets", {}],
    ]);

    expect(
      findMissingNativePeerDependencyMessages(appPackageJson, installed),
    ).toEqual([]);
  });

  it("ignores optional native peer dependencies", () => {
    const appPackageJson = {
      dependencies: {
        "react-native": "0.85.3",
        "react-native-example": "^1.0.0",
      },
    };
    const installed = new Map([
      [
        "react-native-example",
        {
          peerDependencies: {
            "react-native-optional-addon": "^1.0.0",
          },
          peerDependenciesMeta: {
            "react-native-optional-addon": {
              optional: true,
            },
          },
        },
      ],
      ["react-native", {}],
    ]);

    expect(
      findMissingNativePeerDependencyMessages(appPackageJson, installed),
    ).toEqual([]);
  });

  it("requires autolinked iOS podspecs to exist", () => {
    const config = {
      dependencies: {
        "react-native-worklets": {
          platforms: {
            ios: {
              podspecPath: "/missing/RNWorklets.podspec",
            },
          },
        },
      },
    };

    expect(findMissingIosPodspecMessages(config, () => false)).toEqual([
      "react-native-worklets iOS podspec is missing at /missing/RNWorklets.podspec.",
    ]);
  });
});

const repo = path.resolve(import.meta.dirname, "../../..");
const bootstrap = {
  miseToml: readFileSync(path.join(repo, ".mise.toml"), "utf8"),
  postCloneScript: readFileSync(
    path.join(
      repo,
      "packages/tasks-for-obsidian/ios/ci_scripts/ci_post_clone.sh",
    ),
    "utf8",
  ),
  wrapper: readFileSync(path.join(repo, "bin/mise"), "utf8"),
  wrapperExecutable: true,
  project: readFileSync(
    path.join(repo, "packages/tasks-for-obsidian/ios/project.yml"),
    "utf8",
  ),
};

describe("native archive bootstrap", () => {
  it("validates the actual shared producer and rejects missing pins, unchecked downloads and legacy bootstrap", () => {
    expect(findNativeBootstrapMessages(bootstrap)).toEqual([]);
    for (const change of [
      { miseToml: bootstrap.miseToml.replace(/^bun =.*$/m, "") },
      {
        miseToml: bootstrap.miseToml.replace(
          'os = ["macos"]',
          'os = ["linux"]',
        ),
      },
      {
        postCloneScript:
          bootstrap.postCloneScript + '\nBUN_INSTALL_TAG="bun-v1.0.0"',
      },
      {
        postCloneScript: bootstrap.postCloneScript.replace(
          "--frozen-lockfile",
          "--linker hoisted",
        ),
      },
      {
        postCloneScript: bootstrap.postCloneScript.replace(
          "--platform ios-sim",
          "",
        ),
      },
      {
        postCloneScript: bootstrap.postCloneScript.replace(
          "export MISE_EXEC_AUTO_INSTALL=false",
          "",
        ),
      },
      { wrapper: bootstrap.wrapper.replace('"$(shasum_bin)" -c', "true") },
      { wrapperExecutable: false },
      {
        project: bootstrap.project.replace(
          "product: TaskNotesFacetUI",
          "product: LegacyServerClient",
        ),
      },
    ])
      expect(
        findNativeBootstrapMessages({ ...bootstrap, ...change }).length,
      ).toBeGreaterThan(0);
  });

  it("runs post-clone without a preinstalled mise and installs at root before building both iOS slices", () => {
    const root = mkdtempSync(path.join(tmpdir(), "facet-cloud-bootstrap-"));
    try {
      mkdirSync(path.join(root, "bin"));
      mkdirSync(path.join(root, "packages/tasknotes-core"), {
        recursive: true,
      });
      mkdirSync(path.join(root, "packages/tasks-for-obsidian/ios"), {
        recursive: true,
      });
      writeFileSync(path.join(root, ".mise.toml"), bootstrap.miseToml);
      writeFileSync(
        path.join(root, "bin/mise"),
        '#!/bin/bash\nif [ "$1" = exec ] && [ "${MISE_EXEC_AUTO_INSTALL:-}" != false ]; then exit 41; fi\nprintf "%s|%s\\n" "$PWD" "$*" >> "$CI_PRIMARY_REPOSITORY_PATH/calls"\n',
        { mode: 0o755 },
      );
      const hook = path.join(root, "post-clone.sh");
      writeFileSync(hook, bootstrap.postCloneScript);
      const result = spawnSync("/bin/bash", [hook], {
        cwd: tmpdir(),
        encoding: "utf8",
        env: { PATH: "/usr/bin:/bin", CI_PRIMARY_REPOSITORY_PATH: root },
      });
      expect(result.status, result.stderr).toBe(0);
      expect(
        readFileSync(path.join(root, "calls"), "utf8").trim().split("\n"),
      ).toEqual([
        `${root}|trust ${root}/.mise.toml`,
        `${root}|install --yes bun rust aqua:yonaskolb/XcodeGen`,
        `${root}|exec -- bun install --frozen-lockfile --ignore-scripts`,
        `${root}/packages/tasknotes-core|exec -- rustup target add aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios`,
        `${root}/packages/tasknotes-core|exec -- cargo xtask build-xcframework --platform ios --platform ios-sim`,
        `${root}/packages/tasknotes-core|exec -- cargo xtask check-xcframework`,
        `${root}/packages/tasknotes-core|exec -- bun ../tasknotes-macos/scripts/generate-native-notices.ts --ios`,
        `${root}/packages/tasks-for-obsidian/ios|exec -- xcodegen generate`,
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
