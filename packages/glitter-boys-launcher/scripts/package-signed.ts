import path from "node:path";
import { bunRunner } from "@shepherdjerred/native-release/runner";
import {
  nsisSigningCommand,
  powershell,
  signArtifact,
  signedInstallerSource,
} from "@shepherdjerred/native-release/windows";
import { readProfile } from "./release-profile.ts";
import { run } from "./windows-tools.ts";

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
  const { publisher } = await readProfile(root);
  if (publisher === null)
    throw new Error("A signed release profile is required");
  const command = nsisSigningCommand(await powershell(), publisher);
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
  await signArtifact(bunRunner, { file: installer, publisher, cwd: root });
  return installer;
}
