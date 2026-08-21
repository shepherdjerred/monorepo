#!/usr/bin/env bun
//
// The macOS release lane: archive → Developer ID export → notarize → staple →
// verify → zip → dSYMs.
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
//     covered by TypeScript tests on a Linux agent, and manufacturing coverage for it
//     would be ceremony rather than assurance.
//  3. **Its inputs are here.** It reads `project.yml`'s generated `Info.plist`,
//     the entitlements file, and the archive. Root `scripts/release.ts` already
//     exists and means release-please for the npm packages; a second unrelated
//     "release" there would be a name collision on top of everything else.
//
// ## What this script will not do
//
// It never writes a credential to disk. Notarization authenticates through
// `xcrun notarytool --keychain-profile`, which the operator stores once (see
// `AGENTS.md` › Releasing), and that keychain profile is the only credential
// the lane touches.
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

import { basename, join, resolve } from "node:path";

const packageRoot = resolve(import.meta.dir, "..");

// ─── Small process helpers ──────────────────────────────────────────────────

type RunOptions = {
  readonly cwd?: string;
  readonly stdin?: string;
  /** Capture stdout and return it instead of streaming it to the terminal. */
  readonly capture?: boolean;
  /**
   * Return stderr appended to stdout.
   *
   * For the tools that report on the wrong stream. `codesign --display` writes
   * its signature summary — including the `flags=...(runtime)` this lane
   * checks — entirely to stderr and leaves stdout empty, so a caller parsing
   * stdout alone silently sees nothing and concludes the flag is absent.
   */
  readonly includeStderr?: boolean;
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
  return options.includeStderr === true ? `${stdout}${stderr}` : stdout;
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
 * Both are environment, and neither is a secret: the team identifier is public,
 * and the notary profile names a keychain entry rather than carrying one.
 */
type ReleaseConfiguration = {
  readonly teamId: string;
  readonly notaryProfile: string;
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
 * A real run still requires both, and validates the one that has a checkable
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
  if (!dryRun && !/^[A-Z0-9]{10}$/.test(teamId)) {
    fail(
      `TASKNOTES_MAC_TEAM_ID is not a 10-character team identifier: ${teamId}`,
    );
  }
  return {
    teamId,
    notaryProfile: Bun.env["TASKNOTES_MAC_NOTARY_PROFILE"] ?? UNSET,
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

  // ⚠️ No `--limit`. `notarytool history` in Xcode 27 does not accept it and
  // exits 64 with "Unknown option '--limit'", which this probe reported as
  // "notarytool could not use keychain profile" — a stored, Apple-validated
  // credential being described as missing, with instructions to store it again.
  //
  // It survived because the probe had never run against a real credential: the
  // preflight fails on the certificate check first when there is no Developer
  // ID identity, so this line was only ever reached on a machine that was
  // already fully set up. The first time it ran for real, it was wrong.
  const notaryReachable = await toolExists([
    "xcrun",
    "notarytool",
    "history",
    "--keychain-profile",
    configuration.notaryProfile,
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

/**
 * Refuse to ship a build whose signing or sandboxing regressed.
 *
 * Every one of these is something that produces a *working-looking* app: it
 * launches locally and it syncs, and the failure surfaces only at notarization,
 * or later and on somebody else's machine. None of them is caught by the
 * compiler, by SwiftLint, or by any test — which is precisely why they are
 * checked here, against the built artifact rather than against the source that
 * was meant to produce it.
 *
 * Returns the marketing version, which names the distributable archive.
 */
async function verifyExportedApp(
  app: string,
): Promise<{ readonly version: string }> {
  const info = await readPlist(join(app, "Contents", "Info.plist"));

  // ⚠️ Hardened runtime is asserted rather than assumed, because it is now
  // supplied on the archive command line instead of by `project.yml` — see the
  // comment there. A setting that lives in one invocation is a setting that can
  // be dropped by an edit to that invocation, and the consequence would be an
  // app that notarization rejects after a four-minute archive and an upload.
  //
  // `codesign --display --verbose` prints `flags=0x10000(runtime)` when it is
  // on. Its absence here means the archive was built without it.
  const signature = await run(["codesign", "--display", "--verbose=2", app], {
    capture: true,
    includeStderr: true,
  });
  if (!signature.includes("runtime")) {
    fail(
      "the exported app is not built with the hardened runtime, which notarization " +
        "requires. It is passed as ENABLE_HARDENED_RUNTIME=YES on the archive command " +
        "rather than set in project.yml — deliberately, because it makes an ad-hoc " +
        "local Release build unlaunchable — so check that the archive step still " +
        "passes it.",
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
  if (entitlements["com.apple.security.app-sandbox"] !== true) {
    fail(
      "the exported app is not sandboxed. The app has been sandboxed since commit one " +
        "and its file access is built around that; a build that lost the entitlement is " +
        "a regression in App/TaskNotes.entitlements or in how it was signed, not a " +
        "loosening anybody chose.",
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

  const required = ["TaskNotes.app.dSYM", "TaskNotesCore.framework.dSYM"];
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
    // ⚠️ Enabled here rather than in `project.yml`, and the two halves of that
    // decision have to stay together. Hardened runtime enforces library
    // validation, which requires every loaded library to share the main
    // executable's Team ID — satisfiable once this archive is signed with a
    // Developer ID, and *not* satisfiable for an ad-hoc local build, where it
    // makes the app die at launch unable to load its own embedded
    // `TaskNotesCore.framework`. Notarization requires it, so it belongs on the
    // notarized path and nowhere else.
    "ENABLE_HARDENED_RUNTIME=YES",
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
    await verifyExportedApp(archivedApp);
    console.log("  hardened runtime, entitlements and sandboxing: ok");

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
      join(releaseDirectory, "notarization-TaskNotes-<version>.zip"),
    ]);
    wouldRun([
      "xcrun",
      "notarytool",
      "submit",
      join(releaseDirectory, "notarization-TaskNotes-<version>.zip"),
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
      "ditto",
      "-c",
      "-k",
      "--sequesterRsrc",
      "--keepParent",
      exportedApp,
      join(releaseDirectory, "TaskNotes-<version>.zip"),
    ]);
    console.log(
      "\nUnproven without a Developer ID certificate and App Store Connect " +
        "credentials: the export, the notarization round trip, stapling, and the " +
        "Gatekeeper assessment.",
    );
    return;
  }

  announce("exporting with Developer ID");
  await run(exportCommand);

  announce("checking the exported app");
  const { version } = await verifyExportedApp(exportedApp);
  // `--deep` on *verification* is correct and is what Apple recommends; it is
  // `--deep` on *signing* that is banned, because it flattens per-item
  // entitlements across nested code. Different flag, same spelling. It is what
  // walks into the embedded `TaskNotesCore.framework` rather than stopping at
  // the app's own signature.
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
  // on. The app embeds `TaskNotesCore.framework`, so a zip that follows
  // symlinks flattens `Versions/` and breaks its code signature.
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
  // Beside the export rather than in a persistent directory somewhere else.
  // There is no update feed to accumulate into: the app never self-updates, so
  // a release is one zip that a human moves wherever it is being handed out.
  const distributable = join(releaseDirectory, archiveName);
  await run([
    "ditto",
    "-c",
    "-k",
    "--sequesterRsrc",
    "--keepParent",
    exportedApp,
    distributable,
  ]);

  announce("done");
  console.log(`  app        ${exportedApp}`);
  console.log(`  archive    ${distributable}`);
  console.log(`  dSYMs      ${dsymDirectory}`);
  console.log(
    `\n${archiveName} is the notarized, stapled build to hand out.\n` +
      `Keep ${basename(dsymDirectory)} somewhere permanent: it is the only way to read ` +
      "a Rust frame in a crash report from this build.",
  );
}

await main();
