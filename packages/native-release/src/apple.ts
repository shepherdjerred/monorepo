/**
 * Developer ID signing, notarization, stapling and Gatekeeper assessment for
 * macOS release lanes. The certificate lives in the operator's keychain and
 * notarization authenticates with a `notarytool` keychain profile, so nothing
 * here ever receives, reads or prints a secret.
 *
 * Command builders are pure so a dry run can print exactly what a real run
 * would execute; the step functions run them through a {@link ProcessRunner}.
 */
import {
  capture,
  run,
  succeeds,
  type ProcessRunner,
  type RunOptions,
} from "./runner.ts";

// ─── Commands ───────────────────────────────────────────────────────────────

/** Sign one bundle with the hardened runtime and a secure timestamp. */
export function codesignCommand(identity: string, path: string): string[] {
  return [
    "codesign",
    "--force",
    "--options",
    "runtime",
    "--timestamp",
    "--sign",
    identity,
    path,
  ];
}

/**
 * Sign a disk image. The hardened runtime applies to code, not to a disk
 * image, so only the identity and a timestamp.
 */
export function diskImageCodesignCommand(
  identity: string,
  path: string,
): string[] {
  return ["codesign", "--force", "--timestamp", "--sign", identity, path];
}

/**
 * Verify a signed bundle. `--deep` is correct on *verification* (it walks
 * nested frameworks); it is `--deep` on *signing* that is banned.
 */
export function codesignVerifyCommand(path: string): string[] {
  return ["codesign", "--verify", "--deep", "--strict", "--verbose=2", path];
}

/** `codesign --display`, whose summary (with the `runtime` flag) is on stderr. */
export function codesignDisplayCommand(path: string): string[] {
  return ["codesign", "--display", "--verbose=2", path];
}

/**
 * A zip Apple's notary service accepts. `ditto -c -k --sequesterRsrc
 * --keepParent` preserves the symlinks a framework's `Versions/` layout
 * depends on; a zip that follows them breaks the code signature.
 */
export function notarizationArchiveCommand(
  app: string,
  archive: string,
): string[] {
  return ["ditto", "-c", "-k", "--sequesterRsrc", "--keepParent", app, archive];
}

/** Notarize `path` (a zip or a disk image) and wait for Apple's verdict. */
export function notarizeCommand(path: string, profile: string): string[] {
  return [
    "xcrun",
    "notarytool",
    "submit",
    path,
    "--keychain-profile",
    profile,
    "--wait",
  ];
}

export function stapleCommand(path: string): string[] {
  return ["xcrun", "stapler", "staple", path];
}

export function stapleValidateCommand(path: string): string[] {
  return ["xcrun", "stapler", "validate", path];
}

/** What Gatekeeper is asked to assess. */
export type AssessmentKind = "app" | "diskImage";

export function assessCommand(kind: AssessmentKind, path: string): string[] {
  return kind === "app"
    ? ["spctl", "--assess", "--type", "execute", "--verbose=4", path]
    : [
        "spctl",
        "--assess",
        "--type",
        "open",
        "--context",
        "context:primary-signature",
        "--verbose=4",
        path,
      ];
}

/**
 * Probe for a Command Line Tools or Xcode binary. `xcrun --find` rather than
 * `--version`: `codesign` and `spctl` accept no such flag, so probing them
 * that way reports every healthy machine as broken.
 */
export function xcrunProbe(tool: string): string[] {
  return ["xcrun", "--find", tool];
}

// ─── Preflight ──────────────────────────────────────────────────────────────

export type ToolProbe = {
  readonly name: string;
  readonly probe: readonly string[];
};

/** The names of the tools whose probe command fails. */
export async function missingTools(
  runner: ProcessRunner,
  tools: readonly ToolProbe[],
  options: RunOptions = {},
): Promise<string[]> {
  const missing: string[] = [];
  for (const { name, probe } of tools) {
    if (!(await succeeds(runner, probe, options))) missing.push(name);
  }
  return missing;
}

/** Reject anything that is not a 10-character Apple Developer team ID. */
export function assertTeamId(variable: string, teamId: string): void {
  if (!/^[A-Z0-9]{10}$/.test(teamId)) {
    throw new Error(`${variable} is not a 10-character team ID: ${teamId}`);
  }
}

const IDENTITY_LINE = /^\s*\d+\)\s+([0-9A-F]{40})\s+"(.+)"\s*$/;

/**
 * The SHA-1s of the Developer ID Application identities for `teamId` in
 * `security find-identity -v -p codesigning` output.
 */
export function developerIdIdentities(
  identities: string,
  teamId: string,
): string[] {
  const hashes: string[] = [];
  for (const line of identities.split("\n")) {
    const match = IDENTITY_LINE.exec(line);
    const hash = match?.[1];
    const name = match?.[2];
    if (
      hash !== undefined &&
      name?.startsWith("Developer ID Application: ") === true &&
      name.endsWith(`(${teamId})`)
    ) {
      hashes.push(hash);
    }
  }
  return hashes;
}

/**
 * The one Developer ID Application identity for `teamId`, by SHA-1 so it is
 * unambiguous to codesign. Exactly one must match; two would make the choice a
 * guess.
 */
export function findDeveloperIdIdentity(
  identities: string,
  teamId: string,
): string {
  const [identity, ...others] = developerIdIdentities(identities, teamId);
  if (identity === undefined) {
    throw new Error(
      `No valid "Developer ID Application" certificate for team ${teamId} is in an unlocked keychain. Install it from https://developer.apple.com/account/resources/certificates or unlock its keychain. Present identities:\n${identities}`,
    );
  }
  if (others.length > 0) {
    throw new Error(
      `More than one Developer ID Application certificate for team ${teamId}; remove the expired one so the choice is not a guess`,
    );
  }
  return identity;
}

/** Look the identity up in the keychain; throws when it is missing or ambiguous. */
export async function readDeveloperIdIdentity(
  runner: ProcessRunner,
  teamId: string,
  options: RunOptions = {},
): Promise<string> {
  return findDeveloperIdIdentity(
    await capture(
      runner,
      ["security", "find-identity", "-v", "-p", "codesigning"],
      options,
    ),
    teamId,
  );
}

/**
 * Prove the stored notary profile authenticates, without submitting anything.
 *
 * No `--limit`: `notarytool history` in Xcode 27 rejects it (exit 64,
 * "Unknown option '--limit'"), which this probe once reported as a stored,
 * Apple-validated credential being missing.
 */
export async function assertNotaryProfile(
  runner: ProcessRunner,
  profile: string,
  teamId: string,
  options: RunOptions = {},
): Promise<void> {
  const usable = await succeeds(
    runner,
    ["xcrun", "notarytool", "history", "--keychain-profile", profile],
    options,
  );
  if (!usable) {
    throw new Error(
      `notarytool could not use keychain profile "${profile}". Store it once with xcrun notarytool store-credentials ${profile} --apple-id <apple-id> --team-id ${teamId}; it prompts for an app-specific password and keeps it in the keychain. Do not put it in a file or in this repository.`,
    );
  }
}

export type AppleSigning = {
  /** SHA-1 of the Developer ID Application identity. */
  readonly identity: string;
  readonly notaryProfile: string;
};

/**
 * The credential half of a preflight: a well-formed team ID, exactly one
 * Developer ID identity, and a usable notary profile. Throws on the first
 * problem; it never falls back.
 */
export async function preflightAppleSigning(
  runner: ProcessRunner,
  input: {
    readonly teamIdVariable: string;
    readonly teamId: string;
    readonly notaryProfile: string;
  } & RunOptions,
): Promise<AppleSigning> {
  const { teamIdVariable, teamId, notaryProfile, ...options } = input;
  assertTeamId(teamIdVariable, teamId);
  const identity = await readDeveloperIdIdentity(runner, teamId, options);
  await assertNotaryProfile(runner, notaryProfile, teamId, options);
  return { identity, notaryProfile };
}

// ─── Steps ──────────────────────────────────────────────────────────────────

/** Sign an `.app` (or other bundle) with the hardened runtime. */
export async function signBundle(
  runner: ProcessRunner,
  identity: string,
  path: string,
  options: RunOptions = {},
): Promise<void> {
  await run(runner, codesignCommand(identity, path), options);
}

/** Sign a disk image. */
export async function signDiskImage(
  runner: ProcessRunner,
  identity: string,
  path: string,
  options: RunOptions = {},
): Promise<void> {
  await run(runner, diskImageCodesignCommand(identity, path), options);
}

/** `codesign --verify --deep --strict`. */
export async function verifyCodesign(
  runner: ProcessRunner,
  path: string,
  options: RunOptions = {},
): Promise<void> {
  await run(runner, codesignVerifyCommand(path), options);
}

/**
 * Throw unless `path` is signed with the hardened runtime, which notarization
 * requires. `hint` is appended for a lane that knows why it might be missing.
 */
export async function assertHardenedRuntime(
  runner: ProcessRunner,
  path: string,
  hint = "",
  options: RunOptions = {},
): Promise<void> {
  const display = await capture(runner, codesignDisplayCommand(path), {
    ...options,
    includeStderr: true,
  });
  if (!display.includes("runtime")) {
    throw new Error(
      `${path} is not signed with the hardened runtime, which notarization requires${hint === "" ? "" : `. ${hint}`}`,
    );
  }
}

/** Zip `app` and submit the zip to the notary service, waiting for the verdict. */
export async function notarizeBundle(
  runner: ProcessRunner,
  input: { app: string; archive: string; profile: string } & RunOptions,
): Promise<void> {
  const { app, archive, profile, ...options } = input;
  await run(runner, notarizationArchiveCommand(app, archive), options);
  await run(runner, notarizeCommand(archive, profile), options);
}

/** Submit a disk image (or any directly notarizable file) and wait for the verdict. */
export async function notarizeFile(
  runner: ProcessRunner,
  path: string,
  profile: string,
  options: RunOptions = {},
): Promise<void> {
  await run(runner, notarizeCommand(path, profile), options);
}

/** Staple the notarization ticket and validate it. */
export async function stapleAndValidate(
  runner: ProcessRunner,
  path: string,
  options: RunOptions = {},
): Promise<void> {
  await run(runner, stapleCommand(path), options);
  await run(runner, stapleValidateCommand(path), options);
}

/** Ask Gatekeeper to assess `path`. */
export async function assess(
  runner: ProcessRunner,
  kind: AssessmentKind,
  path: string,
  options: RunOptions = {},
): Promise<void> {
  await run(runner, assessCommand(kind, path), options);
}
