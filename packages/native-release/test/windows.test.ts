import { describe, expect, test } from "vitest";
import {
  ARTIFACT_SIGNING_CONFIG_PATH,
  ArtifactSigningConfigSchema,
  nsisSigningCommand,
  preflightSigningCommand,
  readArtifactSigningConfig,
  signArtifact,
  signArtifactCommand,
  signedInstallerSource,
  verifySignatureCommand,
} from "@shepherdjerred/native-release/windows";
import { recordingRunner } from "./recording-runner.ts";

const template = `!define OUTFILE "old.exe"\n!define UNINSTALLERSIGNCOMMAND ""\n!if "\${UNINSTALLERSIGNCOMMAND}" != ""\n  !uninstfinalize '\${UNINSTALLERSIGNCOMMAND}'\n!endif`;

describe("signedInstallerSource", () => {
  test("quotes the NSIS signing command correctly and fails closed", () => {
    const output = signedInstallerSource(
      template,
      String.raw`C:\release\setup.exe`,
      String.raw`"C:\Program Files\pwsh.exe" -File "C:\sign.ps1" -Path "%1"`,
    );
    expect(output).toContain("!if '${UNINSTALLERSIGNCOMMAND}' != ''");
    expect(output).toContain("!uninstfinalize '${UNINSTALLERSIGNCOMMAND}' = 0");
    expect(() =>
      signedInstallerSource(template + "\n" + template, "setup.exe", "sign"),
    ).toThrow();
    expect(() =>
      signedInstallerSource(template, "setup.exe", "sign\nmalicious"),
    ).toThrow();
  });
});

describe("PowerShell command lines", () => {
  test("sign and verify against one exact publisher", () => {
    expect(signArtifactCommand("pwsh", String.raw`C:\a.exe`, "CN=Me")).toEqual([
      "pwsh",
      "-NoProfile",
      "-NonInteractive",
      "-File",
      expect.stringMatching(/windows[\\/]sign-artifact\.ps1$/),
      "-Path",
      String.raw`C:\a.exe`,
      "-Publisher",
      "CN=Me",
    ]);
    expect(
      verifySignatureCommand("pwsh", String.raw`C:\a.exe`, "CN=Me"),
    ).toContain("-Publisher");
    expect(preflightSigningCommand("pwsh").at(-1)).toMatch(
      /preflight-signing\.ps1$/,
    );
  });

  test("the NSIS command carries the publisher and the file placeholder", () => {
    const command = nsisSigningCommand(String.raw`C:\pwsh.exe`, "CN=Me, O=Me");
    expect(command).toContain('-Path "%1" -Publisher "CN=Me, O=Me"');
    expect(() => nsisSigningCommand("pwsh", 'CN="x"')).toThrow(
      "Unsupported publisher characters",
    );
  });

  test("refuses to sign without a publisher and never spawns", async () => {
    const { runner, calls } = recordingRunner(() => ({ exitCode: 0 }));
    await expect(
      signArtifact(runner, { file: "a.exe", publisher: null }),
    ).rejects.toThrow("A signed release profile is required");
    expect(calls).toHaveLength(0);
  });
});

describe("artifact signing config", () => {
  test("the shared config matches its schema", async () => {
    const config = await readArtifactSigningConfig();
    expect(config.CertificateProfileName).toBe("publictrust");
    expect(ARTIFACT_SIGNING_CONFIG_PATH).toMatch(/artifact-signing\.json$/);
  });

  test("rejects an incomplete config", () => {
    expect(() =>
      ArtifactSigningConfigSchema.parse({ Endpoint: "not a url" }),
    ).toThrow();
  });
});
