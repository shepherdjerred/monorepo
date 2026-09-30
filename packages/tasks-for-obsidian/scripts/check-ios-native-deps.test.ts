import { describe, expect, it } from "vitest";
import {
  findBunVersionDriftMessages,
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

  it("accepts a bun pin matching the mise toolchain", () => {
    expect(
      findBunVersionDriftMessages({
        miseToml: '[tools]\nbun = "1.4.2"\n',
        postCloneScript: 'BUN_INSTALL_TAG="bun-v1.4.2"\n',
      }),
    ).toEqual([]);
  });

  it("reports drift between the mise toolchain and the Xcode Cloud bun pin", () => {
    expect(
      findBunVersionDriftMessages({
        miseToml: '[tools]\nbun = "1.4.2"\n',
        postCloneScript: 'BUN_INSTALL_TAG="bun-v1.3.13"\n',
      }),
    ).toEqual([
      "Xcode Cloud installs bun 1.3.13 but the repo pins bun 1.4.2 in .mise.toml. Align BUN_INSTALL_TAG in ios/ci_scripts/ci_post_clone.sh — an older bun cannot parse the current bun.lock and fails the Archive during post-clone install.",
    ]);
  });

  it("fails loudly when either bun version is unparseable", () => {
    expect(
      findBunVersionDriftMessages({
        miseToml: '[tools]\nnode = "24.19.0"\n',
        postCloneScript: 'BUN_INSTALL_TAG="bun-v1.4.2"\n',
      }),
    ).toEqual([
      'Could not find `bun = "<version>"` in the root .mise.toml; the Xcode Cloud bun pin cannot be validated.',
    ]);
    expect(
      findBunVersionDriftMessages({
        miseToml: '[tools]\nbun = "1.4.2"\n',
        postCloneScript: "# no bun pin here\n",
      }),
    ).toEqual([
      'Could not find BUN_INSTALL_TAG="bun-v<version>" in ios/ci_scripts/ci_post_clone.sh; the Xcode Cloud bun pin cannot be validated.',
    ]);
  });
});
