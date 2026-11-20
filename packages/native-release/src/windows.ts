/**
 * Authenticode signing through Microsoft Artifact Signing. The PowerShell
 * scripts in `windows/` do the signing and verification; this module locates
 * PowerShell 7, builds their command lines and checks the signing config.
 * Credentials come from the operator's `az login`; nothing here handles them.
 */
import { readdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { ProcessRunner } from "./runner.ts";

/** The shape of `windows/artifact-signing.json`, passed to signtool's `/dmdf`. */
export const ArtifactSigningConfigSchema = z.object({
  Endpoint: z.url(),
  CodeSigningAccountName: z.string().min(1),
  CertificateProfileName: z.string().min(1),
  /** Credential types the signing client must not try; only `az login` is used. */
  ExcludeCredentials: z.array(z.string().min(1)),
});

export type ArtifactSigningConfig = z.infer<typeof ArtifactSigningConfigSchema>;

const windowsDirectory = path.join(import.meta.dirname, "..", "windows");

/** The shared signing config, the single source of truth for every product. */
export const ARTIFACT_SIGNING_CONFIG_PATH = path.join(
  windowsDirectory,
  "artifact-signing.json",
);

export const SIGN_ARTIFACT_SCRIPT = path.join(
  windowsDirectory,
  "sign-artifact.ps1",
);
export const VERIFY_SIGNATURE_SCRIPT = path.join(
  windowsDirectory,
  "verify-signature.ps1",
);
export const PREFLIGHT_SIGNING_SCRIPT = path.join(
  windowsDirectory,
  "preflight-signing.ps1",
);

export async function readArtifactSigningConfig(
  file = ARTIFACT_SIGNING_CONFIG_PATH,
): Promise<ArtifactSigningConfig> {
  return ArtifactSigningConfigSchema.parse(await Bun.file(file).json());
}

/** PowerShell 7, from PATH, Program Files or the Store install. */
export async function powershell(): Promise<string> {
  const onPath = Bun.which("pwsh");
  if (onPath !== null) return onPath;
  const programFiles = Bun.env["ProgramFiles"];
  if (programFiles === undefined || programFiles === "")
    throw new Error("ProgramFiles is unavailable");
  const regular = path.join(programFiles, "PowerShell", "7", "pwsh.exe");
  if (await Bun.file(regular).exists()) return regular;
  const apps = path.join(programFiles, "WindowsApps");
  const installed = await readdir(apps);
  const names = installed
    .filter((n) => /^Microsoft\.PowerShell_.*_x64__/.test(n))
    .sort()
    .reverse();
  for (const name of names) {
    const executable = path.join(apps, name, "pwsh.exe");
    if (await Bun.file(executable).exists()) return executable;
  }
  throw new Error("Install PowerShell 7 before signing releases");
}

const POWERSHELL_FLAGS = ["-NoProfile", "-NonInteractive"] as const;

/** Sign `file`, then verify the signature names `publisher`. */
export function signArtifactCommand(
  pwsh: string,
  file: string,
  publisher: string,
): string[] {
  return [
    pwsh,
    ...POWERSHELL_FLAGS,
    "-File",
    SIGN_ARTIFACT_SCRIPT,
    "-Path",
    file,
    "-Publisher",
    publisher,
  ];
}

/** Verify `file` carries a valid, timestamped signature by exactly `publisher`. */
export function verifySignatureCommand(
  pwsh: string,
  file: string,
  publisher: string,
): string[] {
  return [
    pwsh,
    ...POWERSHELL_FLAGS,
    "-File",
    VERIFY_SIGNATURE_SCRIPT,
    "-Path",
    file,
    "-Publisher",
    publisher,
  ];
}

/** Check the Windows SDK, signing client, Azure login and certificate profile. */
export function preflightSigningCommand(pwsh: string): string[] {
  return [pwsh, ...POWERSHELL_FLAGS, "-File", PREFLIGHT_SIGNING_SCRIPT];
}

/**
 * The command line NSIS runs to sign an installer or uninstaller. `%1` is the
 * file NSIS passes in. It ends up inside single quotes in the generated
 * script, so see {@link signedInstallerSource} for the characters refused.
 */
export function nsisSigningCommand(pwsh: string, publisher: string): string {
  if (/[\r\n"]/.test(publisher)) {
    throw new Error("Unsupported publisher characters");
  }
  return `"${pwsh}" ${POWERSHELL_FLAGS.join(" ")} -File "${SIGN_ARTIFACT_SCRIPT}" -Path "%1" -Publisher "${publisher}"`;
}

async function runWindows(
  runner: ProcessRunner,
  command: readonly string[],
  cwd: string | undefined,
): Promise<void> {
  const result = await runner(command, {
    ...(cwd === undefined ? {} : { cwd }),
    output: "inherit",
  });
  if (result.exitCode !== 0) {
    throw new Error(`${path.basename(command[0] ?? "Command")} failed`);
  }
}

/**
 * Sign and verify one executable or installer. `publisher` is the full
 * certificate subject the signature must match; a release profile without one
 * is unsigned and must not reach this function.
 */
export async function signArtifact(
  runner: ProcessRunner,
  input: { file: string; publisher: string | null; cwd?: string },
): Promise<void> {
  if (input.publisher === null || input.publisher === "") {
    throw new Error("A signed release profile is required");
  }
  await runWindows(
    runner,
    signArtifactCommand(await powershell(), input.file, input.publisher),
    input.cwd,
  );
}

export async function verifySignature(
  runner: ProcessRunner,
  input: { file: string; publisher: string; cwd?: string },
): Promise<void> {
  await runWindows(
    runner,
    verifySignatureCommand(await powershell(), input.file, input.publisher),
    input.cwd,
  );
}

export async function preflightSigning(
  runner: ProcessRunner,
  cwd?: string,
): Promise<void> {
  await runWindows(runner, preflightSigningCommand(await powershell()), cwd);
}

/**
 * Rewrite a cargo-packager NSIS script so its installer and uninstaller are
 * signed by `signingCommand`. Fails closed: every substitution must match
 * exactly once, and a path or command with characters that could escape the
 * NSIS quoting is refused.
 */
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
    /^ {2}!uninstfinalize .*$/m,
    "  !uninstfinalize '${UNINSTALLERSIGNCOMMAND}' = 0",
  );
  return source;
}
