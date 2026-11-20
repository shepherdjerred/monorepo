import { describe, expect, test } from "vitest";
import {
  MAC_UNIVERSAL_TARGET,
  codesignCommand,
  diskImageCommand,
  findDeveloperIdIdentity,
  macOutputNames,
  packagerEnvironment,
  updateArchiveCommand,
} from "./package-macos.ts";

const HASH_A = "A".repeat(40);
const HASH_B = "B".repeat(40);
const HASH_C = "C".repeat(40);

describe("the macOS release lane", () => {
  test("picks the one Developer ID Application identity for the team", () => {
    const identities = [
      `  1) ${HASH_A} "Apple Development: Someone (ZZZZZZZZZZ)"`,
      `  2) ${HASH_B} "Developer ID Application: Someone (ABCDE12345)"`,
      `  3) ${HASH_C} "Developer ID Application: Other (ZZZZZZZZZZ)"`,
      "     3 valid identities found",
    ].join("\n");
    expect(findDeveloperIdIdentity(identities, "ABCDE12345")).toBe(HASH_B);
  });

  test("fails loudly without exactly one Developer ID identity", () => {
    expect(() =>
      findDeveloperIdIdentity(
        `  1) ${HASH_A} "Apple Development: Someone (ABCDE12345)"\n`,
        "ABCDE12345",
      ),
    ).toThrow(/No valid "Developer ID Application" certificate/);
    expect(() =>
      findDeveloperIdIdentity(
        [
          `  1) ${HASH_A} "Developer ID Application: Someone (ABCDE12345)"`,
          `  2) ${HASH_B} "Developer ID Application: Someone (ABCDE12345)"`,
        ].join("\n"),
        "ABCDE12345",
      ),
    ).toThrow(/More than one/);
  });

  test("names the outputs the publication script and manifest expect", () => {
    expect(macOutputNames("beta", "0.3.0")).toEqual({
      archive: "scout-desktop-beta_0.3.0_universal.app.tar.gz",
      signature: "scout-desktop-beta_0.3.0_universal.app.tar.gz.sig",
      diskImage: "scout-desktop-beta_0.3.0_universal.dmg",
    });
  });

  test("signs with the hardened runtime and a secure timestamp", () => {
    expect(codesignCommand(HASH_B, "/x/Scout Desktop.app")).toEqual([
      "codesign",
      "--force",
      "--options",
      "runtime",
      "--timestamp",
      "--sign",
      HASH_B,
      "/x/Scout Desktop.app",
    ]);
  });

  test("archives the bundle by name without Apple metadata", () => {
    const command = updateArchiveCommand(
      "/dist/stable",
      "Scout Desktop.app",
      "/out/a.app.tar.gz",
    );
    expect(command.slice(-3)).toEqual([
      "-C",
      "/dist/stable",
      "Scout Desktop.app",
    ]);
    for (const flag of ["--no-mac-metadata", "--no-xattrs", "--no-acls"]) {
      expect(command).toContain(flag);
    }
  });

  test("builds a compressed disk image", () => {
    expect(diskImageCommand("Scout Desktop", "/stage", "/out/a.dmg")).toEqual(
      expect.arrayContaining(["-format", "UDZO", "-volname", "Scout Desktop"]),
    );
  });

  test("never lets cargo packager sign or notarize on its own", () => {
    const environment = packagerEnvironment(
      {
        PATH: "/usr/bin",
        CARGO_PACKAGER_SIGN_PRIVATE_KEY: "key",
        CARGO_PACKAGER_SIGN_PRIVATE_KEY_PASSWORD: "password",
        APPLE_SIGNING_IDENTITY: "identity",
        APPLE_KEYCHAIN_PROFILE: "profile",
        SCOUT_DESKTOP_PROFILE: "beta",
      },
      "stable",
      "/archives",
    );
    expect(environment).toEqual({
      PATH: "/usr/bin",
      SCOUT_DESKTOP_PROFILE: "stable",
      SCOUT_DESKTOP_TARGET: MAC_UNIVERSAL_TARGET,
      SHERPA_ONNX_ARCHIVE_DIR: "/archives",
    });
  });
});
