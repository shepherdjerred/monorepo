#!/usr/bin/env bun
//
// The macOS release lane: archive → Developer ID export → notarize → staple →
// verify → appcast → dSYMs.
//
// ## Why this lives here and not in the repository's root `scripts/`
//
// Three reasons, in order of weight.
//
//  1. **It can never run in CI.** Every step needs Xcode, a Developer ID
//     certificate in a keychain, and App Store Connect credentials. This
//     repository's CI is Buildkite on Linux; the plan's testing strategy puts
//     everything Mac-shaped behind a local operator command, exactly as
//     `packages/tasks-for-obsidian` does for iOS e2e. Root `scripts/` is the
//     home of things the Linux graph runs.
//  2. **Root `scripts/` is inside a 90%-coverage gate.** `scripts/` is a bun
//     workspace and `scripts/check-script-coverage.ts` fails the build if its
//     aggregate function/line coverage drops below 90%. A file whose body is
//     `xcodebuild`, `notarytool`, `codesign` and `spctl` invocations cannot be
//     covered by Bun tests on a Linux agent, and manufacturing coverage for it
//     would be ceremony rather than assurance.
//  3. **Its inputs are here.** It reads `project.yml`'s generated `Info.plist`,
//     the entitlements file, the archive, and the Sparkle tools resolved into
//     this package's `.build`. Root `scripts/release.ts` already exists and
//     means release-please for the npm packages; a second unrelated "release"
//     there would be a name collision on top of everything else.
//
// ## What this script will not do
//
// It never writes a credential to disk. Notarization authenticates through
// `xcrun notarytool --keychain-profile`, which the operator stores once (see
// `AGENTS.md` › Releasing); Sparkle's EdDSA private key is read from the login
// Keychain, or piped to `generate_appcast --ed-key-file -` from an environment
// variable, and in neither case does it touch the filesystem.
//
// ## Usage
//
//     bun run mac:release              # the real thing
//     bun run mac:release --dry-run    # everything that needs no credentials
//
// `--dry-run` runs preflight, XcodeGen, the Release archive, every structural
// check against the archived app, and the dSYM collection — then prints the
// exact commands the credentialed half would have run. It is the most that can
// be executed on a machine with no certificate.

import { stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

const packageRoot = resolve(import.meta.dir, "..");

// ─── Small process helpers ──────────────────────────────────────────────────

type RunOptions = {
  readonly cwd?: string;
  readonly stdin?: string;
  /** Capture stdout and return it instead of streaming it to the terminal. */
  readonly capture?: boolean;
};

/**
 * Run a command, or die describing it.
 *
 * There is deliberately no "keep going" mode and no swallowed exit code: this
 * script signs and ships executable code, and a step that half-worked has to
 * stop the lane rather than be reported and stepped over.
 */
async function run(
  command: readonly string[],
  options: RunOptions = {},
): Promise<string> {
  const child = Bun.spawn(command, {
    cwd: options.cwd ?? packageRoot,
    stdin:
      options.stdin === undefined
        ? "ignore"
        : new TextEncoder().encode(options.stdin),
    stdout: options.capture === true ? "pipe" : "inherit",
    stderr: options.capture === true ? "pipe" : "inherit",
  });
  const stdout =
    options.capture === true ? await new Response(child.stdout).text() : "";
  const stderr =
    options.capture === true ? await new Response(child.stderr).text() : "";
  const status = await child.exited;
  if (status !== 0) {
    const detail = options.capture === true ? `\n${stdout}\n${stderr}` : "";
    throw new Error(
      `${command.join(" ")} exited ${status.toString()}${detail}`,
    );
  }
  return stdout;
}

/** Whether a tool resolves at all, so a missing one is named rather than guessed at. */
async function toolExists(command: readonly string[]): Promise<boolean> {
  const child = Bun.spawn(command, { stdout: "ignore", stderr: "ignore" });
  return (await child.exited) === 0;
}

function fail(message: string): never {
  throw new Error(message);
}

// ─── Untyped-data narrowing, without a type assertion ───────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === "string")
  );
}

/** A property list, as JSON. `plutil` is the only parser involved. */
async function readPlist(path: string): Promise<Record<string, unknown>> {
  const text = await run(["plutil", "-convert", "json", "-o", "-", path], {
    capture: true,
  });
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed)) {
    fail(`${path} did not parse as a property-list dictionary`);
  }
  return parsed;
}

function requireString(
  plist: Record<string, unknown>,
  key: string,
  where: string,
): string {
  const value = plist[key];
  if (typeof value !== "string" || value.length === 0) {
    fail(`${where} is missing a non-empty ${key}`);
  }
  return value;
}

// ─── Configuration ──────────────────────────────────────────────────────────

/**
 * Everything the lane needs that is not in the repository.
 *
 * All of it is environment, none of it is a secret except by reference: the
 * team identifier and the download prefix are public, and the two credential
 * knobs name a keychain entry rather than carrying one.
 */
type ReleaseConfiguration = {
  readonly teamId: string;
  readonly notaryProfile: string;
  readonly updatesDirectory: string;
  readonly downloadUrlPrefix: string;
  /** Optional: the EdDSA private key, piped to `generate_appcast`. */
  readonly sparklePrivateKey: string | undefined;
};

const environmentHelp: ReadonlyMap<string, string> = new Map([
  [
    "TASKNOTES_MAC_TEAM_ID",
    "the 10-character Apple Developer team identifier the Developer ID certificate belongs to",
  ],
  [
    "TASKNOTES_MAC_NOTARY_PROFILE",
    "the notarytool keychain profile name — create it once with " +
      "`xcrun notarytool store-credentials <name> --apple-id <id> --team-id <team>`",
  ],
  [
    "TASKNOTES_MAC_UPDATES_DIR",
    "a persistent directory holding every published archive plus appcast.xml; " +
      "generate_appcast reads it to build deltas and to keep older entries, so it " +
      "must be the same directory every release and must not be inside .build",
  ],
  [
    "TASKNOTES_MAC_DOWNLOAD_URL_PREFIX",
    "the public URL the archives are served from, ending in a slash; it becomes the " +
      "enclosure URL in the appcast. ⚠️ It must live under the same host as SUFeedURL " +
      "and it cannot be changed for anyone who already installed a build",
  ],
]);

/**
 * What a placeholder looks like in a dry run's printed commands.
 *
 * Deliberately not a plausible value. It appears only inside `wouldRun` output
 * and inside an `ExportOptions.plist` that a dry run lints but never exports
 * with, so it has to be obviously unusable if it is ever seen anywhere else.
 *
 * ⚠️ **No angle brackets.** The conventional `<unset>` spelling is XML-invalid
 * inside a plist string, so it turns the dry run's `plutil -lint` into a parse
 * error about the placeholder rather than a real check of the document's shape.
 * Caught by running it.
 */
const UNSET = "UNSET";

/**
 * Read the lane's environment.
 *
 * ⚠️ **A dry run requires none of it, and that is the whole point of the mode.**
 * `--dry-run` is documented as "the most that can be executed on a machine with
 * no certificate" — so demanding a team identifier and a notary profile before
 * it will start contradicts its own contract and makes the credential-free path
 * unreachable for the person who most needs it. Every variable a dry run touches
 * is either printed inside a `wouldRun` line or interpolated into an
 * `ExportOptions.plist` that gets structurally linted and then not used.
 *
 * A real run still requires all four, and validates the two that have a checkable
 * shape. The validation is deliberately skipped in a dry run rather than relaxed:
 * a placeholder that failed the team-identifier regex would be a confusing error
 * about a value the operator never set.
 */
function readConfiguration(dryRun: boolean): ReleaseConfiguration {
  const missing = [...environmentHelp.keys()].filter((name) => {
    const value = Bun.env[name];
    return value === undefined || value.length === 0;
  });
  if (missing.length > 0 && !dryRun) {
    const lines = missing.map(
      (name) => `  ${name}\n      ${environmentHelp.get(name) ?? ""}`,
    );
    fail(
      `the release lane needs these environment variables:\n${lines.join("\n")}`,
    );
  }
  if (missing.length > 0) {
    console.log(
      `dry run: ${String(missing.length)} unset variable(s) will print as ` +
        `${UNSET} — ${missing.join(", ")}\n`,
    );
  }
  const teamId = Bun.env["TASKNOTES_MAC_TEAM_ID"] ?? UNSET;
  const downloadUrlPrefix =
    Bun.env["TASKNOTES_MAC_DOWNLOAD_URL_PREFIX"] ?? UNSET;
  if (!dryRun && !/^[A-Z0-9]{10}$/.test(teamId)) {
    fail(
      `TASKNOTES_MAC_TEAM_ID is not a 10-character team identifier: ${teamId}`,
    );
  }
  if (
    !dryRun &&
    (!downloadUrlPrefix.startsWith("https://") ||
      !downloadUrlPrefix.endsWith("/"))
  ) {
    fail(
      "TASKNOTES_MAC_DOWNLOAD_URL_PREFIX must be an https URL ending in a slash — " +
        "Sparkle refuses plain http under App Transport Security, and a prefix without " +
        `a trailing slash concatenates into a wrong URL. Got: ${downloadUrlPrefix}`,
    );
  }
  const sparklePrivateKey = Bun.env["TASKNOTES_MAC_SPARKLE_ED_PRIVATE_KEY"];
  return {
    teamId,
    notaryProfile: Bun.env["TASKNOTES_MAC_NOTARY_PROFILE"] ?? UNSET,
    // `resolve` on an empty string yields the current directory, which would
    // print as a real-looking path in a dry run's appcast line. Keep the
    // placeholder visible instead.
    updatesDirectory:
      Bun.env["TASKNOTES_MAC_UPDATES_DIR"] === undefined ||
      Bun.env["TASKNOTES_MAC_UPDATES_DIR"].length === 0
        ? UNSET
        : resolve(Bun.env["TASKNOTES_MAC_UPDATES_DIR"]),
    downloadUrlPrefix,
    sparklePrivateKey:
      sparklePrivateKey === undefined || sparklePrivateKey.length === 0
        ? undefined
        : sparklePrivateKey,
  };
}

// ─── Paths ──────────────────────────────────────────────────────────────────

const releaseDirectory = join(packageRoot, ".build", "release");
const archivePath = join(releaseDirectory, "TaskNotes.xcarchive");
const exportDirectory = join(releaseDirectory, "export");
const exportOptionsPath = join(releaseDirectory, "ExportOptions.plist");
const dsymDirectory = join(releaseDirectory, "dsyms");
const exportedApp = join(exportDirectory, "TaskNotes.app");
const archivedApp = join(
  archivePath,
  "Products",
  "Applications",
  "TaskNotes.app",
);

/**
 * Sparkle's command-line tools, as resolved by SwiftPM.
 *
 * They ship inside the binary artifact rather than as a separate download, so
 * the tool that signs an update is by construction the same version as the
 * framework that will verify it. Resolving the path rather than hard-coding it
 * is what keeps that true across a Sparkle bump.
 */
async function sparkleToolDirectory(): Promise<string> {
  const binPath = (
    await run(["swift", "build", "--show-bin-path"], { capture: true })
  ).trim();
  const candidates = [
    join(packageRoot, ".build", "artifacts", "sparkle", "Sparkle", "bin"),
    join(binPath, "..", "..", "..", "artifacts", "sparkle", "Sparkle", "bin"),
  ];
  for (const candidate of candidates) {
    if (await Bun.file(join(candidate, "generate_appcast")).exists()) {
      return resolve(candidate);
    }
  }
  fail(
    "could not find Sparkle's generate_appcast. It ships inside the SwiftPM binary " +
      `artifact; run 'swift package resolve' first. Looked in:\n  ${candidates.join("\n  ")}`,
  );
}

// ─── Preflight ──────────────────────────────────────────────────────────────

/**
 * Everything that can be wrong before a single byte is built.
 *
 * Ordered cheapest-first, and deliberately including the two credential checks:
 * discovering a missing certificate after a four-minute archive, or a missing
 * notary profile after a completed export, is the difference between a typo and
 * a wasted afternoon.
 */
async function preflight(
  configuration: ReleaseConfiguration,
  dryRun: boolean,
): Promise<void> {
  if (process.platform !== "darwin") {
    fail(`the macOS release lane needs macOS; this is ${process.platform}`);
  }

  const tools: ReadonlyArray<readonly [string, readonly string[], string]> = [
    [
      "xcodebuild",
      ["xcodebuild", "-version"],
      "install Xcode and run xcode-select",
    ],
    ["xcodegen", ["xcodegen", "--version"], "brew install xcodegen"],
    ["notarytool", ["xcrun", "--find", "notarytool"], "ships with Xcode"],
    ["stapler", ["xcrun", "--find", "stapler"], "ships with Xcode"],
    // `xcrun --find` rather than a `--version` probe: `codesign --version` and
    // `spctl --version` are not flags either tool accepts, so probing them that
    // way reports every healthy machine as broken.
    [
      "codesign",
      ["xcrun", "--find", "codesign"],
      "ships with the command line tools",
    ],
    [
      "spctl",
      ["xcrun", "--find", "spctl"],
      "ships with the command line tools",
    ],
    [
      "ditto",
      ["xcrun", "--find", "ditto"],
      "ships with the command line tools",
    ],
    [
      "plutil",
      ["xcrun", "--find", "plutil"],
      "ships with the command line tools",
    ],
    [
      "security",
      ["xcrun", "--find", "security"],
      "ships with the command line tools",
    ],
    [
      "cargo",
      ["cargo", "--version"],
      "the Rust core's xtask builds the XCFramework",
    ],
  ];
  const missingTools: string[] = [];
  for (const [name, probe, remedy] of tools) {
    if (!(await toolExists(probe))) {
      missingTools.push(`  ${name} — ${remedy}`);
    }
  }
  if (missingTools.length > 0) {
    fail(`missing required tools:\n${missingTools.join("\n")}`);
  }

  // `Bun.file(...).exists()` answers `false` for a directory, so this asks the
  // filesystem the question it is actually being asked. Skipped in a dry run,
  // where the variable is allowed to be unset: there is no appcast to build.
  const updatesDirectoryIsDirectory = await stat(configuration.updatesDirectory)
    .then((entry) => entry.isDirectory())
    .catch(() => false);
  if (!updatesDirectoryIsDirectory && !dryRun) {
    fail(
      `TASKNOTES_MAC_UPDATES_DIR does not exist: ${configuration.updatesDirectory}\n` +
        "  Create it, and keep it — it is the accumulated history the appcast is built " +
        "from. A fresh empty directory silently publishes a feed with one entry and no " +
        "delta updates.",
    );
  }

  const identities = await run(
    ["security", "find-identity", "-v", "-p", "codesigning"],
    {
      capture: true,
    },
  );
  const hasDeveloperId = identities
    .split("\n")
    .some(
      (line) =>
        line.includes("Developer ID Application") &&
        line.includes(`(${configuration.teamId})`),
    );
  if (!hasDeveloperId) {
    const message =
      `no "Developer ID Application" certificate for team ${configuration.teamId} is in ` +
      "any unlocked keychain.\n" +
      "  Create one at https://developer.apple.com/account/resources/certificates and\n" +
      "  install it, or unlock the keychain that holds it. Present identities:\n" +
      identities;
    if (!dryRun) {
      fail(message);
    }
    console.warn(`[dry-run] ${message}`);
  }

  const notaryReachable = await toolExists([
    "xcrun",
    "notarytool",
    "history",
    "--keychain-profile",
    configuration.notaryProfile,
    "--limit",
    "1",
  ]);
  if (!notaryReachable) {
    const message =
      `notarytool could not use keychain profile "${configuration.notaryProfile}".\n` +
      "  Store it once with:\n" +
      `    xcrun notarytool store-credentials ${configuration.notaryProfile} \\\n` +
      `      --apple-id <apple-id> --team-id ${configuration.teamId}\n` +
      "  It prompts for an app-specific password and keeps it in the keychain. Do not " +
      "put it in a file or in this repository.";
    if (!dryRun) {
      fail(message);
    }
    console.warn(`[dry-run] ${message}`);
  }
}

// ─── Structural checks on the built app ─────────────────────────────────────

const sparkleFrameworkPath = join(
  "Contents",
  "Frameworks",
  "Sparkle.framework",
);
const installerServicePath = join(
  sparkleFrameworkPath,
  "Versions",
  "B",
  "XPCServices",
  "Installer.xpc",
);

/**
 * Refuse to ship a build whose updater is misconfigured.
 *
 * Every one of these is something that produces a *working-looking* app: it
 * launches, it syncs, and the only symptom is that updates never arrive, or
 * arrive and fail at the final install step, months later and on somebody
 * else's machine. None of them is caught by the compiler, by SwiftLint, or by
 * any test — which is precisely why they are checked here, against the built
 * artifact rather than against the source that was meant to produce it.
 */
async function verifyUpdaterConfiguration(
  app: string,
  dryRun: boolean,
): Promise<{ readonly version: string }> {
  const info = await readPlist(join(app, "Contents", "Info.plist"));

  // ⚠️ **Absent is tolerated in a dry run; malformed never is.**
  //
  // "No feed configured" is a *supported* state of this app today, not a
  // mistake: the appcast host is an open decision, and `UpdaterController`
  // deliberately renders a disabled "Check for Updates…" item rather than a
  // hidden one when these two keys are missing. Failing the dry run on them
  // would make the credential-free path unreachable until that decision is
  // taken — which is precisely backwards, because the point of the dry run is
  // to prove the pipeline *before* the release is possible.
  //
  // A key that is present but wrong is a different thing and still fails: that
  // is a paste error, and both of these produce an app that launches, syncs,
  // and never updates.
  const feedUrl = info["SUFeedURL"];
  const publicKey = info["SUPublicEDKey"];
  const unset = (value: unknown): boolean =>
    value === undefined || (typeof value === "string" && value.length === 0);

  if (dryRun && unset(feedUrl) && unset(publicKey)) {
    console.warn(
      "  [dry-run] SUFeedURL and SUPublicEDKey are unset — the appcast host is " +
        "still an open decision, and the app ships a disabled Check for Updates " +
        "item until it is taken. A real release refuses this.",
    );
  } else {
    const url = requireString(info, "SUFeedURL", `${app} Info.plist`);
    if (!url.startsWith("https://")) {
      fail(
        `SUFeedURL must be https, and is ${url}. Sparkle warns rather than refusing, ` +
          "but an appcast over plain http is a remote-code-execution channel with no " +
          "transport authentication.",
      );
    }

    const key = requireString(info, "SUPublicEDKey", `${app} Info.plist`);
    // 32 raw bytes of ed25519 public key is exactly 44 base64 characters with a
    // single pad. Checking the shape here rather than trusting the paste is
    // worthwhile because Sparkle treats a malformed key as a *start* failure —
    // the app would ship and then show a modal alert on every launch.
    if (!/^[A-Za-z0-9+/]{43}=$/.test(key)) {
      fail(
        `SUPublicEDKey is not a 32-byte base64 ed25519 public key: ${key}\n` +
          "  Run Sparkle's ./bin/generate_keys to print the public half.",
      );
    }
  }

  if (info["SUEnableInstallerLauncherService"] !== true) {
    fail(
      "SUEnableInstallerLauncherService must be true. This app is sandboxed, and " +
        "without the Installer XPC service Sparkle cannot replace the app bundle — " +
        "the download succeeds and the install fails.",
    );
  }
  if (info["SUEnableDownloaderService"] === true) {
    fail(
      "SUEnableDownloaderService must not be set. Sparkle's guidance is that the " +
        "downloader service exists only for sandboxed apps without " +
        "com.apple.security.network.client; this app has that entitlement, and enabling " +
        "the service would swap release notes onto a deprecated WebKit1 view.",
    );
  }

  if (
    !(await Bun.file(
      join(app, installerServicePath, "Contents", "Info.plist"),
    ).exists())
  ) {
    fail(
      `${installerServicePath} is missing from the exported app.\n` +
        "  Sparkle validates this at startup and refuses to start without it, so this " +
        "would ship an app that shows an 'Unable to Check For Updates' alert one second " +
        "into every launch.",
    );
  }

  const entitlementsPath = join(releaseDirectory, "exported.entitlements");
  await run([
    "codesign",
    "-d",
    "--entitlements",
    entitlementsPath,
    "--xml",
    app,
  ]);
  const entitlements = await readPlist(entitlementsPath);
  const machLookup =
    entitlements[
      "com.apple.security.temporary-exception.mach-lookup.global-name"
    ];
  const bundleId = requireString(
    info,
    "CFBundleIdentifier",
    `${app} Info.plist`,
  );
  const expected = [`${bundleId}-spks`, `${bundleId}-spki`];
  if (
    !isStringArray(machLookup) ||
    expected.some((name) => !machLookup.includes(name))
  ) {
    fail(
      "the signed entitlements are missing Sparkle's Mach service exceptions.\n" +
        `  Expected both of ${expected.join(" and ")} under\n` +
        "  com.apple.security.temporary-exception.mach-lookup.global-name.\n" +
        "  Without them the sandbox refuses the connection to the installer and every " +
        "update fails at the last step.",
    );
  }
  if (entitlements["com.apple.security.app-sandbox"] !== true) {
    fail(
      "the exported app is not sandboxed. Either the entitlements file regressed, or " +
        "the Mach exceptions above are now dead weight — decide which, do not ship both.",
    );
  }
  if (entitlements["com.apple.security.get-task-allow"] === true) {
    fail(
      "the exported app carries com.apple.security.get-task-allow, which notarization " +
        "rejects. It belongs to Debug builds only; this means a Release archive was " +
        "exported with a development profile.",
    );
  }

  return {
    version: requireString(
      info,
      "CFBundleShortVersionString",
      `${app} Info.plist`,
    ),
  };
}

/**
 * Collect every dSYM the archive produced, and insist on the two that matter.
 *
 * ⚠️ **The app's own dSYM does not contain the Rust core's symbols.** Measured,
 * not assumed: because the bindings product is a dynamic library, the Rust
 * static archive links into `TaskNotesCore.framework` rather than into the app
 * executable, so `TaskNotes.app.dSYM` holds **zero** `tasknotes_core` symbols
 * while `TaskNotesCore.framework.dSYM` holds thousands. Shipping only the first
 * would leave every Rust frame in a user's crash report unsymbolicated, which
 * is the exact thing the `reldbg` profile and `DEBUG_INFORMATION_FORMAT =
 * dwarf-with-dsym` exist for.
 *
 * Sparkle's five dSYMs come along for free — they are inside its SwiftPM
 * artifact and Xcode copies them into the archive — and they are worth keeping
 * for the same reason: a crash inside the updater is a crash in shipped code.
 */
async function collectDsyms(): Promise<readonly string[]> {
  const source = join(archivePath, "dSYMs");
  await run(["rm", "-rf", dsymDirectory]);
  await run(["mkdir", "-p", dsymDirectory]);
  await run(["ditto", source, dsymDirectory]);

  const listed = await run(["ls", dsymDirectory], { capture: true });
  const present = listed
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.endsWith(".dSYM"));

  const required = [
    "TaskNotes.app.dSYM",
    "TaskNotesCore.framework.dSYM",
    "Sparkle.framework.dSYM",
  ];
  const missing = required.filter((name) => !present.includes(name));
  if (missing.length > 0) {
    fail(
      `the archive is missing required debug symbols: ${missing.join(", ")}\n` +
        `  Found: ${present.join(", ")}\n` +
        "  TaskNotesCore.framework.dSYM is the one holding the Rust core's symbols; " +
        "without it a Rust frame in a crash report is a bare address.",
    );
  }
  return present;
}

// ─── The lane ───────────────────────────────────────────────────────────────

function announce(step: string): void {
  console.log(`\n── ${step} ${"─".repeat(Math.max(0, 70 - step.length))}`);
}

function wouldRun(command: readonly string[]): void {
  console.log(`[dry-run] would run: ${command.join(" ")}`);
}

async function main(): Promise<void> {
  const dryRun = Bun.argv.includes("--dry-run");
  const configuration = readConfiguration(dryRun);

  announce("preflight");
  await preflight(configuration, dryRun);

  announce("regenerating the Xcode project and checking the Rust XCFramework");
  await run(["xcodegen", "generate"]);
  await run(
    [
      "cargo",
      "run",
      "--quiet",
      "--package",
      "xtask",
      "--",
      "check-xcframework",
    ],
    {
      cwd: resolve(packageRoot, "..", "tasknotes-core"),
    },
  );

  announce("archiving (Release)");
  await run(["rm", "-rf", releaseDirectory]);
  await run(["mkdir", "-p", releaseDirectory]);
  await run([
    "xcodebuild",
    "archive",
    "-project",
    "TaskNotes.xcodeproj",
    "-scheme",
    "TaskNotes",
    "-configuration",
    "Release",
    "-destination",
    "generic/platform=macOS",
    "-archivePath",
    archivePath,
    "-derivedDataPath",
    join(packageRoot, ".build", "xcode"),
  ]);

  announce("collecting debug symbols");
  const dsyms = await collectDsyms();
  console.log(`  ${dsyms.join("\n  ")}`);

  // ExportOptions is generated rather than committed: it carries the team
  // identifier, which is per-operator, and a committed copy is how a repository
  // ends up depending on one person's account.
  const exportOptions =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" ' +
    '"http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n' +
    '<plist version="1.0">\n' +
    "<dict>\n" +
    "\t<key>method</key><string>developer-id</string>\n" +
    `\t<key>teamID</key><string>${configuration.teamId}</string>\n` +
    "\t<key>signingStyle</key><string>manual</string>\n" +
    "\t<key>signingCertificate</key><string>Developer ID Application</string>\n" +
    "\t<key>manageAppVersionAndBuildNumber</key><false/>\n" +
    "\t<key>destination</key><string>export</string>\n" +
    "</dict>\n" +
    "</plist>\n";
  await Bun.write(exportOptionsPath, exportOptions);
  await run(["plutil", "-lint", exportOptionsPath]);

  const exportCommand = [
    "xcodebuild",
    "-exportArchive",
    "-archivePath",
    archivePath,
    "-exportOptionsPlist",
    exportOptionsPath,
    "-exportPath",
    exportDirectory,
  ];

  if (dryRun) {
    announce("structural checks against the *archived* app");
    // The archived app is ad-hoc signed here rather than Developer ID signed,
    // so the entitlements and Info.plist checks are meaningful while the
    // notarization ones are not. Running them against what exists is the point
    // of a dry run.
    await verifyUpdaterConfiguration(archivedApp, dryRun);
    console.log("  updater configuration, entitlements and XPC service: ok");

    announce("what the credentialed half would do");
    wouldRun(exportCommand);
    wouldRun([
      "codesign",
      "--verify",
      "--deep",
      "--strict",
      "--verbose=2",
      exportedApp,
    ]);
    wouldRun([
      "ditto",
      "-c",
      "-k",
      "--sequesterRsrc",
      "--keepParent",
      exportedApp,
      join(releaseDirectory, "TaskNotes-<version>.zip"),
    ]);
    wouldRun([
      "xcrun",
      "notarytool",
      "submit",
      join(releaseDirectory, "TaskNotes-<version>.zip"),
      "--keychain-profile",
      configuration.notaryProfile,
      "--wait",
    ]);
    wouldRun(["xcrun", "stapler", "staple", exportedApp]);
    wouldRun(["xcrun", "stapler", "validate", exportedApp]);
    wouldRun([
      "spctl",
      "--assess",
      "--type",
      "execute",
      "--verbose=4",
      exportedApp,
    ]);
    wouldRun([
      join(await sparkleToolDirectory(), "generate_appcast"),
      "--download-url-prefix",
      configuration.downloadUrlPrefix,
      configuration.updatesDirectory,
    ]);
    console.log(
      "\nUnproven without a Developer ID certificate and App Store Connect " +
        "credentials: the export, the notarization round trip, stapling, the " +
        "Gatekeeper assessment, and appcast signing.",
    );
    return;
  }

  announce("exporting with Developer ID");
  await run(exportCommand);

  announce("checking the exported app");
  const { version } = await verifyUpdaterConfiguration(exportedApp, false);
  // `--deep` on *verification* is correct and is what Apple and Sparkle both
  // recommend; it is `--deep` on *signing* that is banned, because it flattens
  // per-item entitlements across nested code. Different flag, same spelling.
  await run([
    "codesign",
    "--verify",
    "--deep",
    "--strict",
    "--verbose=2",
    exportedApp,
  ]);

  const archiveName = `TaskNotes-${version}.zip`;
  const notarizationZip = join(releaseDirectory, `notarization-${archiveName}`);

  announce("notarizing");
  // `ditto -c -k --sequesterRsrc --keepParent` is the documented way to make an
  // archive that preserves the symlinks a framework's version layout depends
  // on. A zip that follows symlinks breaks Sparkle's code signature.
  await run([
    "ditto",
    "-c",
    "-k",
    "--sequesterRsrc",
    "--keepParent",
    exportedApp,
    notarizationZip,
  ]);
  await run([
    "xcrun",
    "notarytool",
    "submit",
    notarizationZip,
    "--keychain-profile",
    configuration.notaryProfile,
    "--wait",
  ]);

  announce("stapling and assessing");
  // Staple the *app*, not the zip: the ticket has to travel inside the bundle
  // so a first launch works with no network. That is also why the distributable
  // archive is built again below, after stapling.
  await run(["xcrun", "stapler", "staple", exportedApp]);
  await run(["xcrun", "stapler", "validate", exportedApp]);
  await run([
    "spctl",
    "--assess",
    "--type",
    "execute",
    "--verbose=4",
    exportedApp,
  ]);
  await run([
    "codesign",
    "--verify",
    "--deep",
    "--strict",
    "--verbose=2",
    exportedApp,
  ]);

  announce("building the distributable archive");
  const distributable = join(configuration.updatesDirectory, archiveName);
  await run([
    "ditto",
    "-c",
    "-k",
    "--sequesterRsrc",
    "--keepParent",
    exportedApp,
    distributable,
  ]);

  announce("generating the appcast");
  const generateAppcast = join(
    await sparkleToolDirectory(),
    "generate_appcast",
  );
  const appcastCommand = [
    generateAppcast,
    "--download-url-prefix",
    configuration.downloadUrlPrefix,
    configuration.updatesDirectory,
  ];
  if (configuration.sparklePrivateKey === undefined) {
    // No key on the command line and none in a file: generate_appcast reads the
    // private key from the login Keychain, which is where generate_keys put it.
    await run(appcastCommand);
  } else {
    // The other supported shape, for an operator who keeps the key in 1Password
    // rather than in the Keychain. It goes in on stdin so it is never an
    // argument (visible in `ps`) and never a file.
    await run([...appcastCommand, "--ed-key-file", "-"], {
      stdin: configuration.sparklePrivateKey,
    });
  }

  announce("done");
  console.log(`  app        ${exportedApp}`);
  console.log(`  archive    ${distributable}`);
  console.log(
    `  appcast    ${join(configuration.updatesDirectory, "appcast.xml")}`,
  );
  console.log(`  dSYMs      ${dsymDirectory}`);
  console.log(
    `\nUpload every file in ${configuration.updatesDirectory} — the archive, any ` +
      `*.delta, and appcast.xml — under ${configuration.downloadUrlPrefix}\n` +
      `Keep ${basename(dsymDirectory)} somewhere permanent: it is the only way to read ` +
      "a Rust frame in a crash report from this build.",
  );
}

await main();
