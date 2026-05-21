import { describe, expect, it } from "bun:test";
import {
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
