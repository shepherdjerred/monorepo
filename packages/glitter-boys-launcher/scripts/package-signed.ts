import path from "node:path";
import { powershell, run, signArtifact } from "./windows-tools.ts";

export function signedInstallerSource(
  source: string,
  installer: string,
  signingCommand: string,
): string {
  const replace = (pattern: RegExp, replacement: string) => {
    if ([...source.matchAll(new RegExp(pattern.source, "gm"))].length !== 1)
      throw new Error("Unexpected cargo-packager NSIS signing contract");
    source = source.replace(pattern, () => replacement);
  };
  if (/[\r\n'$]/.test(signingCommand) || /[\r\n"$]/.test(installer))
    throw new Error("Unsupported signing path characters");
  replace(/^!define OUTFILE .*$/m, `!define OUTFILE "${installer}"`);
  replace(
    /^!define UNINSTALLERSIGNCOMMAND .*$/m,
    `!define UNINSTALLERSIGNCOMMAND '${signingCommand}'`,
  );
  replace(
    /^!if "\$\{UNINSTALLERSIGNCOMMAND\}" != ""$/m,
    "!if '${UNINSTALLERSIGNCOMMAND}' != ''",
  );
  replace(
    /^  !uninstfinalize .*$/m,
    "  !uninstfinalize '${UNINSTALLERSIGNCOMMAND}' = 0",
  );
  return source;
}
export async function packageSigned(
  root: string,
  version: string,
): Promise<string> {
  await run(
    ["cargo", "packager", "--release", "--packages", "glitter-boys-app"],
    root,
  );
  const installer = path.join(
    root,
    "dist",
    `glitter-boys_${version}_x64-setup.exe`,
  );
  const sourceDirectory = path.join(
    root,
    "dist",
    ".cargo-packager",
    "nsis",
    "x64",
  );
  const source = await Bun.file(
    path.join(sourceDirectory, "installer.nsi"),
  ).text();
  if (!source.includes(`!define VERSION "${version}"`))
    throw new Error("Installer version mismatch");
  const command = `"${await powershell()}" -NoProfile -NonInteractive -File "${path.join(root, "scripts", "sign-artifact.ps1")}" -Path "%1"`;
  const signed = path.join(sourceDirectory, "installer-signed.nsi");
  await Bun.write(signed, signedInstallerSource(source, installer, command));
  const local = process.env["LOCALAPPDATA"];
  if (!local) throw new Error("LOCALAPPDATA is unavailable");
  await run(
    [
      path.join(local, ".cargo-packager", "NSIS", "makensis.exe"),
      "/V2",
      "/INPUTCHARSET",
      "UTF8",
      signed,
    ],
    sourceDirectory,
  );
  await signArtifact(root, installer);
  return installer;
}
