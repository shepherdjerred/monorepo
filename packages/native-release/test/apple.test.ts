import { describe, expect, test } from "vitest";
import {
  assertHardenedRuntime,
  assertNotaryProfile,
  assertTeamId,
  assess,
  assessCommand,
  codesignCommand,
  codesignVerifyCommand,
  diskImageCodesignCommand,
  findDeveloperIdIdentity,
  missingTools,
  notarizeBundle,
  notarizeCommand,
  preflightAppleSigning,
  signBundle,
  stapleAndValidate,
  xcrunProbe,
} from "@shepherdjerred/native-release/apple";
import { recordingRunner } from "./recording-runner.ts";

const HASH_A = "A".repeat(40);
const HASH_B = "B".repeat(40);
const HASH_C = "C".repeat(40);
const TEAM = "ABCDE12345";
const IDENTITIES = [
  `  1) ${HASH_A} "Apple Development: Someone (ZZZZZZZZZZ)"`,
  `  2) ${HASH_B} "Developer ID Application: Someone (${TEAM})"`,
  `  3) ${HASH_C} "Developer ID Application: Other (ZZZZZZZZZZ)"`,
  "     3 valid identities found",
].join("\n");

describe("Developer ID identity lookup", () => {
  test("picks the one Developer ID Application identity for the team", () => {
    expect(findDeveloperIdIdentity(IDENTITIES, TEAM)).toBe(HASH_B);
  });

  test("fails loudly without exactly one identity", () => {
    expect(() =>
      findDeveloperIdIdentity(
        `  1) ${HASH_A} "Apple Development: Someone (${TEAM})"\n`,
        TEAM,
      ),
    ).toThrow(/No valid "Developer ID Application" certificate/);
    expect(() =>
      findDeveloperIdIdentity(
        [
          `  1) ${HASH_A} "Developer ID Application: Someone (${TEAM})"`,
          `  2) ${HASH_B} "Developer ID Application: Someone (${TEAM})"`,
        ].join("\n"),
        TEAM,
      ),
    ).toThrow(/More than one/);
  });

  test("rejects a malformed team ID naming the variable", () => {
    expect(() => assertTeamId("MY_TEAM", "short")).toThrow(
      "MY_TEAM is not a 10-character team ID: short",
    );
    expect(() => assertTeamId("MY_TEAM", TEAM)).not.toThrow();
  });
});

describe("command builders", () => {
  test("sign bundles with the hardened runtime and a timestamp", () => {
    expect(codesignCommand(HASH_B, "/x/App.app")).toEqual([
      "codesign",
      "--force",
      "--options",
      "runtime",
      "--timestamp",
      "--sign",
      HASH_B,
      "/x/App.app",
    ]);
  });

  test("sign disk images without the runtime option, which is for code", () => {
    expect(diskImageCodesignCommand(HASH_B, "/out/a.dmg")).toEqual([
      "codesign",
      "--force",
      "--timestamp",
      "--sign",
      HASH_B,
      "/out/a.dmg",
    ]);
  });

  test("verify deeply and strictly", () => {
    expect(codesignVerifyCommand("/x/App.app")).toEqual([
      "codesign",
      "--verify",
      "--deep",
      "--strict",
      "--verbose=2",
      "/x/App.app",
    ]);
  });

  test("notarize and wait", () => {
    expect(notarizeCommand("/x.zip", "profile")).toEqual([
      "xcrun",
      "notarytool",
      "submit",
      "/x.zip",
      "--keychain-profile",
      "profile",
      "--wait",
    ]);
  });

  test("assess apps as executables and disk images as primary signatures", () => {
    expect(assessCommand("app", "/x/App.app")).toEqual([
      "spctl",
      "--assess",
      "--type",
      "execute",
      "--verbose=4",
      "/x/App.app",
    ]);
    expect(assessCommand("diskImage", "/x.dmg")).toEqual([
      "spctl",
      "--assess",
      "--type",
      "open",
      "--context",
      "context:primary-signature",
      "--verbose=4",
      "/x.dmg",
    ]);
  });
});

describe("preflight", () => {
  test("names every tool whose probe fails", async () => {
    const { runner, calls } = recordingRunner((command) => ({
      exitCode: command.includes("stapler") ? 1 : 0,
    }));
    expect(
      await missingTools(runner, [
        { name: "codesign", probe: xcrunProbe("codesign") },
        { name: "stapler", probe: xcrunProbe("stapler") },
      ]),
    ).toEqual(["stapler"]);
    expect(calls).toHaveLength(2);
  });

  test("probes the notary profile without submitting or passing --limit", async () => {
    const { runner, calls } = recordingRunner(() => ({ exitCode: 0 }));
    await assertNotaryProfile(runner, "profile", TEAM);
    expect(calls).toEqual([
      ["xcrun", "notarytool", "history", "--keychain-profile", "profile"],
    ]);
  });

  test("fails loudly, with the store-credentials remedy, when the profile is unusable", async () => {
    const { runner } = recordingRunner(() => ({ exitCode: 64 }));
    await expect(assertNotaryProfile(runner, "profile", TEAM)).rejects.toThrow(
      /store-credentials profile --apple-id <apple-id> --team-id ABCDE12345/,
    );
  });

  test("returns the identity and profile once every credential check passes", async () => {
    const { runner, calls } = recordingRunner((command) =>
      command[0] === "security"
        ? { exitCode: 0, stdout: IDENTITIES }
        : { exitCode: 0 },
    );
    expect(
      await preflightAppleSigning(runner, {
        teamIdVariable: "TEAM",
        teamId: TEAM,
        notaryProfile: "profile",
      }),
    ).toEqual({ identity: HASH_B, notaryProfile: "profile" });
    expect(calls.map((command) => command[0])).toEqual(["security", "xcrun"]);
  });

  test("stops at the first failing check and never reaches notarytool", async () => {
    const { runner, calls } = recordingRunner(() => ({
      exitCode: 0,
      stdout: "     0 valid identities found",
    }));
    await expect(
      preflightAppleSigning(runner, {
        teamIdVariable: "TEAM",
        teamId: TEAM,
        notaryProfile: "profile",
      }),
    ).rejects.toThrow(/No valid "Developer ID Application"/);
    expect(calls).toHaveLength(1);
    await expect(
      preflightAppleSigning(runner, {
        teamIdVariable: "TEAM",
        teamId: "bad",
        notaryProfile: "profile",
      }),
    ).rejects.toThrow("TEAM is not a 10-character team ID: bad");
    expect(calls).toHaveLength(1);
  });
});

describe("steps", () => {
  test("sign, notarize, staple and assess in order", async () => {
    const { runner, calls } = recordingRunner(() => ({ exitCode: 0 }));
    await signBundle(runner, HASH_B, "/x/App.app");
    await notarizeBundle(runner, {
      app: "/x/App.app",
      archive: "/x/n.zip",
      profile: "profile",
    });
    await stapleAndValidate(runner, "/x/App.app");
    await assess(runner, "app", "/x/App.app");
    expect(calls.map((command) => command.slice(0, 3).join(" "))).toEqual([
      "codesign --force --options",
      "ditto -c -k",
      "xcrun notarytool submit",
      "xcrun stapler staple",
      "xcrun stapler validate",
      "spctl --assess --type",
    ]);
  });

  test("a failing step throws and nothing after it runs", async () => {
    const { runner, calls } = recordingRunner((command) => ({
      exitCode: command[2] === "submit" ? 1 : 0,
    }));
    await expect(
      notarizeBundle(runner, {
        app: "/x/App.app",
        archive: "/x/n.zip",
        profile: "profile",
      }),
    ).rejects.toThrow(/notarytool submit .* exited 1/);
    expect(calls).toHaveLength(2);
  });

  test("reads the hardened runtime flag from stderr and fails when it is absent", async () => {
    const present = recordingRunner(() => ({
      exitCode: 0,
      stderr: "flags=0x10000(runtime)",
    }));
    await assertHardenedRuntime(present.runner, "/x/App.app");
    const absent = recordingRunner(() => ({
      exitCode: 0,
      stderr: "flags=0x0(none)",
    }));
    await expect(
      assertHardenedRuntime(absent.runner, "/x/App.app", "check the archive"),
    ).rejects.toThrow(/hardened runtime.*check the archive/);
  });
});
