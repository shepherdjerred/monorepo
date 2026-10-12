import { expect, test } from "bun:test";
import { signedInstallerSource } from "./package-signed.ts";
const template = `!define OUTFILE "old.exe"\n!define UNINSTALLERSIGNCOMMAND ""\n!if "\${UNINSTALLERSIGNCOMMAND}" != ""\n  !uninstfinalize '\${UNINSTALLERSIGNCOMMAND}'\n!endif`;
test("NSIS signing is quoted correctly and fails closed", () => {
  const output = signedInstallerSource(
    template,
    "C:\\release\\setup.exe",
    '"C:\\Program Files\\pwsh.exe" -File "C:\\sign.ps1" -Path "%1"',
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
