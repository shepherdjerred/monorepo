import { describe, expect, test } from "vitest";
import {
  MAC_UNIVERSAL_TARGET,
  diskImageCommand,
  macOutputNames,
  packagerEnvironment,
  updateArchiveCommand,
} from "./package-macos.ts";

describe("the macOS release lane", () => {
  test("names the outputs the publication script and manifest expect", () => {
    expect(macOutputNames("beta", "0.3.0")).toEqual({
      archive: "scout-desktop-beta_0.3.0_universal.app.tar.gz",
      signature: "scout-desktop-beta_0.3.0_universal.app.tar.gz.sig",
      diskImage: "scout-desktop-beta_0.3.0_universal.dmg",
    });
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
