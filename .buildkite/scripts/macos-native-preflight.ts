#!/usr/bin/env bun

const MINIMUM_FREE_GIB = 40;
const KIB_PER_GIB = 1024 * 1024;
const TASKNOTES_RUST_TARGETS = [
  "aarch64-apple-darwin",
  "x86_64-apple-darwin",
] as const;

type NativeSuite = "quotabar" | "tasknotes";

export function parseNativeSuite(value: string | undefined): NativeSuite {
  if (value === "quotabar" || value === "tasknotes") return value;
  throw new Error("usage: macos-native-preflight.ts <quotabar|tasknotes>");
}

export function appleDevelopmentIdentities(output: string): string[] {
  const identities: string[] = [];
  for (const line of output.split("\n")) {
    const match = /^\s*\d+\)\s+([0-9a-f]{40})\s+"Apple Development:/iu.exec(
      line,
    );
    const fingerprint = match?.[1];
    if (fingerprint !== undefined) identities.push(fingerprint.toUpperCase());
  }
  return identities;
}

function isTable(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * `.mise.toml` is the single pin for dev machines and CI alike, so the native
 * preflight reads it rather than restating versions that a Renovate bump would
 * silently desynchronise.
 */
export function pinnedToolVersion(miseToml: string, tool: string): string {
  const parsed: unknown = Bun.TOML.parse(miseToml);
  if (!isTable(parsed)) throw new Error(".mise.toml is not a TOML table");
  const tools = parsed["tools"];
  if (!isTable(tools)) throw new Error(".mise.toml has no [tools] table");
  const version = tools[tool];
  if (typeof version !== "string" || version.length === 0) {
    throw new Error(`.mise.toml does not pin ${tool} to a version string`);
  }
  return version;
}

export function availableDiskKib(output: string): number {
  const lines = output.trim().split("\n");
  const lastLine = lines.at(-1);
  if (lastLine === undefined) throw new Error("df returned no filesystem row");
  const fields = lastLine.trim().split(/\s+/u);
  const available = fields.at(-3);
  if (available === undefined || !/^\d+$/u.test(available)) {
    throw new Error(
      `df returned an unreadable available-block count: ${lastLine}`,
    );
  }
  return Number.parseInt(available, 10);
}

export function missingTaskNotesRustTargets(output: string): string[] {
  const installed = new Set(
    output
      .split("\n")
      .map((target) => target.trim())
      .filter((target) => target.length > 0),
  );
  return TASKNOTES_RUST_TARGETS.filter((target) => !installed.has(target));
}

async function run(command: readonly string[]): Promise<string> {
  const child = Bun.spawn([...command], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `${command.join(" ")} exited ${exitCode.toString()}\n${stdout}${stderr}`,
    );
  }
  return stdout.trim();
}

async function requiredVersion(
  command: readonly string[],
  expected: string,
  description: string,
): Promise<void> {
  const actual = await run(command);
  if (actual !== expected) {
    throw new Error(`${description} must be ${expected}, got ${actual}`);
  }
}

async function preflight(suite: NativeSuite): Promise<string | undefined> {
  if (process.platform !== "darwin") {
    throw new Error(
      `native macOS jobs require Darwin, got ${process.platform}`,
    );
  }

  await requiredVersion(["/usr/bin/uname", "-m"], "arm64", "architecture");

  const xcodeVersionFile = await Bun.file(".xcode-version").text();
  const expectedXcode = xcodeVersionFile.trim();
  if (expectedXcode.length === 0) throw new Error(".xcode-version is empty");
  const xcodeVersionOutput = await run(["/usr/bin/xcodebuild", "-version"]);
  const xcodeVersion = xcodeVersionOutput.split("\n").at(0);
  if (xcodeVersion !== `Xcode ${expectedXcode}`) {
    throw new Error(
      `selected Xcode must be ${expectedXcode}, got ${xcodeVersion ?? "no version"}`,
    );
  }
  const developerDirectory = await run(["/usr/bin/xcode-select", "-p"]);
  if (!developerDirectory.endsWith("/Contents/Developer")) {
    throw new Error(
      `xcode-select returned an invalid developer directory: ${developerDirectory}`,
    );
  }

  const miseToml = await Bun.file(".mise.toml").text();
  const expectedBun = pinnedToolVersion(miseToml, "bun");
  const expectedRust = pinnedToolVersion(miseToml, "rust");
  await requiredVersion(
    ["mise", "current", "bun"],
    expectedBun,
    "mise Bun (pinned by .mise.toml)",
  );
  await requiredVersion(
    ["bun", "--version"],
    expectedBun,
    "Bun (pinned by .mise.toml)",
  );
  await requiredVersion(
    ["mise", "current", "rust"],
    expectedRust,
    "mise Rust (pinned by .mise.toml)",
  );
  const rustVersion = await run(["rustc", "--version"]);
  if (!rustVersion.startsWith(`rustc ${expectedRust} `)) {
    throw new Error(
      `Rust must match .mise.toml (expected ${expectedRust}, got ${rustVersion})`,
    );
  }
  await run(["xcodegen", "--version"]);
  await run(["swiftlint", "version"]);

  const fileVaultActive = await run(["/usr/bin/fdesetup", "isactive"]);
  if (fileVaultActive !== "true") {
    throw new Error("FileVault must be active before native CI can run");
  }

  const currentUser = await run(["/usr/bin/id", "-un"]);
  const consoleUser = await run(["/usr/bin/stat", "-f", "%Su", "/dev/console"]);
  if (consoleUser !== currentUser) {
    throw new Error(
      `native CI requires the agent's GUI session to be active; process user ${currentUser}, console user ${consoleUser}`,
    );
  }

  const diskOutput = await run(["/bin/df", "-Pk", "."]);
  const availableKib = availableDiskKib(diskOutput);
  if (availableKib < MINIMUM_FREE_GIB * KIB_PER_GIB) {
    throw new Error(
      `native CI requires at least ${MINIMUM_FREE_GIB.toString()} GiB free, got ${(availableKib / KIB_PER_GIB).toFixed(1)} GiB`,
    );
  }

  if (suite === "tasknotes") {
    const missingRustTargets = missingTaskNotesRustTargets(
      await run(["rustup", "target", "list", "--installed"]),
    );
    if (missingRustTargets.length > 0) {
      throw new Error(
        `TaskNotes CI requires Rust targets ${TASKNOTES_RUST_TARGETS.join(", ")}; missing ${missingRustTargets.join(", ")}. Re-run packages/homelab/mac-ci/bootstrap.sh`,
      );
    }

    const identities = appleDevelopmentIdentities(
      await run([
        "/usr/bin/security",
        "find-identity",
        "-v",
        "-p",
        "codesigning",
      ]),
    );
    if (identities.length !== 1) {
      throw new Error(
        `TaskNotes CI requires exactly one valid Apple Development identity, found ${identities.length.toString()}`,
      );
    }
    return identities[0];
  }
  return undefined;
}

async function main(): Promise<void> {
  const suite = parseNativeSuite(Bun.argv[2]);
  const identity = await preflight(suite);
  console.error(`macOS native preflight passed for ${suite}`);
  if (identity !== undefined) console.log(identity);
}

if (import.meta.main) {
  await main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
