import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  DEFAULT_XCODE_DEVELOPER_DIR,
  resolveXcodeEnvironment,
  SOURCEKIT_RELATIVE_PATH,
} from "./xcode-env.ts";

describe("resolveXcodeEnvironment", () => {
  test("passes environment through unchanged on Linux without requiring Xcode", async () => {
    let checked = false;
    const resolved = await resolveXcodeEnvironment({
      platform: "linux",
      env: { PATH: "/usr/bin" },
      fileExists: () => {
        checked = true;
        return false;
      },
    });

    expect(checked).toBe(false);
    expect(resolved).toEqual({ PATH: "/usr/bin" });
    expect(resolved.DEVELOPER_DIR).toBeUndefined();
  });

  test("auto-selects /Applications/Xcode.app/Contents/Developer on macOS when DEVELOPER_DIR is unset", async () => {
    const expectedSourceKit = join(
      DEFAULT_XCODE_DEVELOPER_DIR,
      SOURCEKIT_RELATIVE_PATH,
    );
    const resolved = await resolveXcodeEnvironment({
      platform: "darwin",
      env: { PATH: "/usr/bin" },
      fileExists: (filePath) => filePath === expectedSourceKit,
    });

    expect(resolved.DEVELOPER_DIR).toBe(DEFAULT_XCODE_DEVELOPER_DIR);
  });

  test("preserves an explicit valid DEVELOPER_DIR on macOS", async () => {
    const customDeveloperDir = "/Applications/Xcode-26.app/Contents/Developer";
    const customSourceKit = join(customDeveloperDir, SOURCEKIT_RELATIVE_PATH);
    const resolved = await resolveXcodeEnvironment({
      platform: "darwin",
      env: { DEVELOPER_DIR: customDeveloperDir },
      fileExists: (filePath) => filePath === customSourceKit,
    });

    expect(resolved.DEVELOPER_DIR).toBe(customDeveloperDir);
  });

  test("fails with a clear diagnostic on macOS when Xcode is missing or DEVELOPER_DIR points at CommandLineTools", async () => {
    await expect(
      resolveXcodeEnvironment({
        platform: "darwin",
        env: {},
        fileExists: () => false,
      }),
    ).rejects.toThrow(/Full Xcode with SourceKit is required on macOS/u);

    await expect(
      resolveXcodeEnvironment({
        platform: "darwin",
        env: { DEVELOPER_DIR: "/Library/Developer/CommandLineTools" },
        fileExists: () => false,
      }),
    ).rejects.toThrow(
      /DEVELOPER_DIR='\/Library\/Developer\/CommandLineTools' does not include SourceKit/u,
    );
  });
});
