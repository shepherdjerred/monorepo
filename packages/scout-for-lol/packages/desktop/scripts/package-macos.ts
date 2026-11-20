// The macOS half of `release:package:<channel>`: a universal (arm64 + x86_64)
// `.app`, signed with Developer ID, notarized, stapled and assessed, then
//
//   - `scout-desktop-<channel>_<version>_universal.app.tar.gz` and its minisign
//     `.sig`: what installed builds update from (the manifest's
//     `darwin-universal` artifact), and
//   - `scout-desktop-<channel>_<version>_universal.dmg`, itself signed,
//     notarized and stapled: what a person downloads to install.
//
// The codesign → notarytool → stapler → spctl sequence is the one
// `packages/tasknotes-macos/scripts/release.ts` uses. The Developer ID
// certificate lives in the operator's keychain and notarization authenticates
// with a `notarytool` keychain profile, so the only secret this process
// receives is the channel's update signing key, from 1Password through
// `with-release-credentials.ts`. Nothing here runs in CI.
//
// `--dry-run` builds the universal app, the archive and the disk image
// unsigned into `dist/<channel>/macos-dry-run/` (which publication never
// reads) and prints the credentialed commands instead of running them.
import { mkdir, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import type { ScoutDesktopUpdateChannel } from "../../data/src/scout-client/desktop-update-manifest.schema.ts";
import { verifyMinisign } from "../../data/src/scout-client/desktop-update-minisign.ts";
import {
  macDiskImageFileName,
  updateArtifactFileName,
} from "../../data/src/scout-client/desktop-update-release.ts";
import { macDryRunDirectory, macOutputDirectory } from "./release-artifacts.ts";

/** The target cargo-packager names a universal macOS package after. */
export const MAC_UNIVERSAL_TARGET = "universal-apple-darwin";
/** The slices `prepare-package.ts` builds and `lipo` joins. */
export const MAC_SLICE_TARGETS = [
  "aarch64-apple-darwin",
  "x86_64-apple-darwin",
] as const;
/** The architectures `lipo -archs` must report for the shipped binary. */
export const MAC_ARCHITECTURES = ["arm64", "x86_64"] as const;

const ENVIRONMENT_HELP = {
  SCOUT_DESKTOP_MAC_TEAM_ID:
    "the 10-character Apple Developer team ID of the Developer ID Application certificate",
  SCOUT_DESKTOP_MAC_NOTARY_PROFILE:
    "the notarytool keychain profile; create it once with `xcrun notarytool store-credentials <name> --apple-id <id> --team-id <team>`",
} as const;

export type MacSigning = {
  /** SHA-1 of the Developer ID Application identity, unambiguous to codesign. */
  identity: string;
  notaryProfile: string;
};

/**
 * The Developer ID Application identity for `teamId` in
 * `security find-identity -v -p codesigning` output, by its SHA-1. Exactly one
 * must match; two would make the choice a guess.
 */
export function findDeveloperIdIdentity(
  identities: string,
  teamId: string,
): string {
  const matches = identities
    .split("\n")
    .map((line) => /^\s*\d+\)\s+([0-9A-F]{40})\s+"(.+)"\s*$/.exec(line))
    .filter((match) => match !== null)
    .filter(
      ([, , name]) =>
        name?.startsWith("Developer ID Application: ") === true &&
        name.endsWith(`(${teamId})`),
    )
    .map(([, hash]) => hash ?? "");
  const [identity, ...others] = matches;
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

/** The output file names for one release. */
export function macOutputNames(
  channel: ScoutDesktopUpdateChannel,
  version: string,
) {
  const archive = updateArtifactFileName(channel, version, "darwin-universal");
  return {
    archive,
    signature: `${archive}.sig`,
    diskImage: macDiskImageFileName(channel, version),
  };
}

/** Sign one bundle or disk image with the hardened runtime and a timestamp. */
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
 * Archive the app for the updater as `<Product>.app/...`, without
 * AppleDouble files, extended attributes or ACLs: the code signature and the
 * stapled ticket live inside the bundle, and `._*` entries would break the
 * signature's seal once unpacked.
 */
export function updateArchiveCommand(
  directory: string,
  appName: string,
  archive: string,
): string[] {
  return [
    "tar",
    "--no-mac-metadata",
    "--no-xattrs",
    "--no-acls",
    "-czf",
    archive,
    "-C",
    directory,
    appName,
  ];
}

/** A compressed, read-only disk image of `folder`. */
export function diskImageCommand(
  volumeName: string,
  folder: string,
  output: string,
): string[] {
  return [
    "hdiutil",
    "create",
    "-volname",
    volumeName,
    "-srcfolder",
    folder,
    "-fs",
    "HFS+",
    "-format",
    "UDZO",
    "-ov",
    output,
  ];
}

type RunOptions = { cwd: string; env?: Record<string, string | undefined> };

/** Run a command, or throw describing it; a half-done signing step stops the lane. */
async function run(command: string[], options: RunOptions): Promise<void> {
  const child = Bun.spawn(command, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdout: "inherit",
    stderr: "inherit",
  });
  const status = await child.exited;
  if (status !== 0) {
    throw new Error(`${command.join(" ")} exited ${String(status)}`);
  }
}

/** Run a command and return its stdout and stderr together. */
async function capture(command: string[], cwd: string): Promise<string> {
  const child = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, status] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (status !== 0) {
    throw new Error(
      `${command.join(" ")} exited ${String(status)}\n${stdout}${stderr}`,
    );
  }
  return `${stdout}${stderr}`;
}

async function succeeds(command: string[], cwd: string): Promise<boolean> {
  const child = Bun.spawn(command, { cwd, stdout: "ignore", stderr: "ignore" });
  return (await child.exited) === 0;
}

function announce(step: string): void {
  console.log(`\n── ${step} ${"─".repeat(Math.max(0, 70 - step.length))}`);
}

function wouldRun(command: string[]): void {
  console.log(`[dry-run] would run: ${command.join(" ")}`);
}

/**
 * Everything that can be missing before a long universal build: tools, Rust
 * targets, and, outside a dry run, the Developer ID identity, the notary
 * profile and the update signing key.
 */
async function preflight(
  root: string,
  dryRun: boolean,
): Promise<MacSigning | null> {
  const tools: [string, string[]][] = [
    ["lipo", ["xcrun", "--find", "lipo"]],
    ["codesign", ["xcrun", "--find", "codesign"]],
    ["notarytool", ["xcrun", "--find", "notarytool"]],
    ["stapler", ["xcrun", "--find", "stapler"]],
    ["hdiutil", ["which", "hdiutil"]],
    ["spctl", ["which", "spctl"]],
    ["ditto", ["which", "ditto"]],
    ["security", ["which", "security"]],
    ["tar", ["which", "tar"]],
  ];
  const missing: string[] = [];
  for (const [name, probe] of tools) {
    if (!(await succeeds(probe, root))) missing.push(name);
  }
  if (missing.length > 0) {
    throw new Error(
      `Missing ${missing.join(", ")}; install Xcode or the command line tools`,
    );
  }
  const installed = await capture(
    ["mise", "exec", "--", "rustup", "target", "list", "--installed"],
    root,
  );
  const absent = MAC_SLICE_TARGETS.filter(
    (target) => !installed.split("\n").includes(target),
  );
  if (absent.length > 0) {
    throw new Error(
      `The universal build needs these Rust targets: mise exec -- rustup target add ${absent.join(" ")}`,
    );
  }
  if (dryRun) {
    console.log(
      "dry run: no Developer ID, notary profile or update key is required",
    );
    return null;
  }

  const unset = Object.keys(ENVIRONMENT_HELP).filter(
    (name) => (process.env[name] ?? "") === "",
  );
  if (unset.length > 0) {
    throw new Error(
      `The macOS release lane needs:\n${Object.entries(ENVIRONMENT_HELP)
        .filter(([name]) => unset.includes(name))
        .map(([name, help]) => `  ${name}: ${help}`)
        .join("\n")}`,
    );
  }
  const teamId = process.env["SCOUT_DESKTOP_MAC_TEAM_ID"] ?? "";
  const notaryProfile = process.env["SCOUT_DESKTOP_MAC_NOTARY_PROFILE"] ?? "";
  if (!/^[A-Z0-9]{10}$/.test(teamId)) {
    throw new Error(
      `SCOUT_DESKTOP_MAC_TEAM_ID is not a 10-character team ID: ${teamId}`,
    );
  }
  for (const name of [
    "CARGO_PACKAGER_SIGN_PRIVATE_KEY",
    "CARGO_PACKAGER_SIGN_PRIVATE_KEY_PASSWORD",
  ]) {
    if ((process.env[name] ?? "") === "") {
      throw new Error(
        `${name} is not set; run through with-release-credentials.ts so the key is injected`,
      );
    }
  }
  const identity = findDeveloperIdIdentity(
    await capture(
      ["security", "find-identity", "-v", "-p", "codesigning"],
      root,
    ),
    teamId,
  );
  // `history` proves the stored profile authenticates without submitting.
  if (
    !(await succeeds(
      ["xcrun", "notarytool", "history", "--keychain-profile", notaryProfile],
      root,
    ))
  ) {
    throw new Error(
      `notarytool could not use keychain profile "${notaryProfile}". Store it once with xcrun notarytool store-credentials ${notaryProfile} --apple-id <apple-id> --team-id ${teamId}; it prompts for an app-specific password and keeps it in the keychain`,
    );
  }
  return { identity, notaryProfile };
}

/**
 * The environment for `cargo packager`: the channel profile and the universal
 * target, and none of the signing variables it would otherwise act on. It
 * must not minisign the app before it is notarized and stapled, nor codesign
 * or notarize on its own (`APPLE_*`); this script does both, in order.
 */
export function packagerEnvironment(
  environment: Record<string, string | undefined>,
  channel: ScoutDesktopUpdateChannel,
  sherpaArchives: string,
): Record<string, string | undefined> {
  const kept = Object.fromEntries(
    Object.entries(environment).filter(
      ([name]) =>
        !name.startsWith("APPLE_") && !name.startsWith("CARGO_PACKAGER_SIGN_"),
    ),
  );
  return {
    ...kept,
    SCOUT_DESKTOP_PROFILE: channel,
    SCOUT_DESKTOP_TARGET: MAC_UNIVERSAL_TARGET,
    SHERPA_ONNX_ARCHIVE_DIR: sherpaArchives,
  };
}

/** Notarize `path` (a zip or a disk image) and wait for Apple's verdict. */
function notarizeCommand(path: string, profile: string): string[] {
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

export type MacPackageInput = {
  root: string;
  channel: ScoutDesktopUpdateChannel;
  version: string;
  productName: string;
  binaryName: string;
  updatePublicKey: string;
  sherpaArchives: string;
  dryRun: boolean;
};

export async function packageMac(input: MacPackageInput): Promise<void> {
  const { root, channel, dryRun } = input;
  announce("preflight");
  const signing = await preflight(root, dryRun);

  const distribution = join(root, "dist", channel);
  const appName = `${input.productName}.app`;
  const app = join(distribution, appName);
  const output = dryRun
    ? macDryRunDirectory(root, channel)
    : macOutputDirectory(root, channel);
  const names = macOutputNames(channel, input.version);
  await rm(app, { recursive: true, force: true });
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });

  announce("building the universal app");
  await run(
    [
      "mise",
      "exec",
      "--",
      "cargo",
      "packager",
      "--release",
      "--config",
      `packaging/${channel}.json`,
      "--formats",
      "app",
      "--target",
      MAC_UNIVERSAL_TARGET,
    ],
    {
      cwd: root,
      env: packagerEnvironment(process.env, channel, input.sherpaArchives),
    },
  );
  const binary = join(app, "Contents", "MacOS", input.binaryName);
  const architectures = (await capture(["lipo", "-archs", binary], root))
    .trim()
    .split(/\s+/);
  for (const architecture of MAC_ARCHITECTURES) {
    if (!architectures.includes(architecture)) {
      throw new Error(
        `${binary} is not universal: lipo reports ${architectures.join(" ")}`,
      );
    }
  }

  const notarizationZip = join(output, "notarization.zip");
  const zipCommand = [
    "ditto",
    "-c",
    "-k",
    "--sequesterRsrc",
    "--keepParent",
    app,
    notarizationZip,
  ];
  const verifyCommand = [
    "codesign",
    "--verify",
    "--deep",
    "--strict",
    "--verbose=2",
    app,
  ];
  announce("signing, notarizing and stapling the app");
  if (signing === null) {
    wouldRun(codesignCommand("<Developer ID>", app));
    wouldRun(verifyCommand);
    wouldRun(zipCommand);
    wouldRun(notarizeCommand(notarizationZip, "<notary profile>"));
    wouldRun(["xcrun", "stapler", "staple", app]);
    wouldRun(["xcrun", "stapler", "validate", app]);
    wouldRun(["spctl", "--assess", "--type", "execute", "--verbose=4", app]);
  } else {
    await run(codesignCommand(signing.identity, app), { cwd: root });
    await run(verifyCommand, { cwd: root });
    const display = await capture(
      ["codesign", "--display", "--verbose=2", app],
      root,
    );
    if (!display.includes("runtime")) {
      throw new Error(
        "The app is not signed with the hardened runtime, which notarization requires",
      );
    }
    await run(zipCommand, { cwd: root });
    await run(notarizeCommand(notarizationZip, signing.notaryProfile), {
      cwd: root,
    });
    await rm(notarizationZip);
    // Staple the app itself so a first launch needs no network; the update
    // archive and the disk image are both built from the stapled bundle.
    await run(["xcrun", "stapler", "staple", app], { cwd: root });
    await run(["xcrun", "stapler", "validate", app], { cwd: root });
    await run(["spctl", "--assess", "--type", "execute", "--verbose=4", app], {
      cwd: root,
    });
    await run(verifyCommand, { cwd: root });
  }

  announce("the update archive");
  const archive = join(output, names.archive);
  await run(updateArchiveCommand(distribution, appName, archive), {
    cwd: root,
    // Belt and braces for bsdtar's AppleDouble `._*` entries.
    env: { ...process.env, COPYFILE_DISABLE: "1" },
  });
  const signCommand = [
    "mise",
    "exec",
    "--",
    "cargo",
    "packager",
    "signer",
    "sign",
    archive,
  ];
  if (signing === null) {
    wouldRun(signCommand);
  } else {
    // Reads CARGO_PACKAGER_SIGN_PRIVATE_KEY(_PASSWORD) from this environment
    // and writes `<archive>.sig`.
    await run(signCommand, { cwd: root });
    verifyMinisign({
      publicKeyBase64: input.updatePublicKey,
      signatureBase64: (
        await Bun.file(join(output, names.signature)).text()
      ).trim(),
      data: new Uint8Array(await Bun.file(archive).arrayBuffer()),
    });
  }

  announce("the disk image");
  const staging = join(output, "dmg-root");
  await mkdir(staging, { recursive: true });
  await run(["ditto", app, join(staging, appName)], { cwd: root });
  await symlink("/Applications", join(staging, "Applications"));
  const diskImage = join(output, names.diskImage);
  await run(diskImageCommand(input.productName, staging, diskImage), {
    cwd: root,
  });
  await rm(staging, { recursive: true, force: true });
  if (signing === null) {
    wouldRun(codesignCommand("<Developer ID>", diskImage));
    wouldRun(notarizeCommand(diskImage, "<notary profile>"));
    wouldRun(["xcrun", "stapler", "staple", diskImage]);
    wouldRun(["xcrun", "stapler", "validate", diskImage]);
    wouldRun([
      "spctl",
      "--assess",
      "--type",
      "open",
      "--context",
      "context:primary-signature",
      "--verbose=4",
      diskImage,
    ]);
  } else {
    await run(
      [
        "codesign",
        "--force",
        "--timestamp",
        "--sign",
        signing.identity,
        diskImage,
      ],
      { cwd: root },
    );
    await run(notarizeCommand(diskImage, signing.notaryProfile), {
      cwd: root,
    });
    await run(["xcrun", "stapler", "staple", diskImage], { cwd: root });
    await run(["xcrun", "stapler", "validate", diskImage], { cwd: root });
    await run(
      [
        "spctl",
        "--assess",
        "--type",
        "open",
        "--context",
        "context:primary-signature",
        "--verbose=4",
        diskImage,
      ],
      { cwd: root },
    );
  }

  announce("done");
  console.log(`  update archive  ${archive}`);
  console.log(`  disk image      ${diskImage}`);
  if (signing === null) {
    console.log(
      "\nUnsigned dry run: Developer ID signing, notarization, stapling, Gatekeeper assessment and the update signature were not run. Publication never reads this directory.",
    );
  }
}
