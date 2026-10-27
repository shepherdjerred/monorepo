import assert from "node:assert/strict";
import { cp, lstat, mkdir, readlink } from "node:fs/promises";
import path from "node:path";
import { acceptanceSigningArguments } from "../acceptance-test-plan.ts";
import {
  macFileSHA,
  readMacArtifact,
  verifyMacArtifact,
  type MacArtifact,
} from "./mac-artifact.ts";
import {
  requireStableSources,
  sourceFingerprints,
} from "./source-provenance.ts";
import {
  isMacSessionPreflightFailure,
  requireUnlockedMac,
} from "./mac-session.ts";

export type MacJourneyCommand = (
  argv: string[],
  capture?: boolean,
  cwd?: string,
) => Promise<string>;

export async function buildMacArtifact(
  root: string,
  evidence: string,
  command: MacJourneyCommand,
): Promise<MacArtifact> {
  const workspace = path.resolve(root, "../..");
  const inputs = () =>
    sourceFingerprints(workspace, (argv) => command(argv, true, workspace));
  const sources = await inputs(),
    sourceHead = (
      await command(["git", "rev-parse", "HEAD"], true, workspace)
    ).trim();
  await Bun.write(
    path.join(evidence, "sources-before.json"),
    JSON.stringify(sources),
  );
  await buildMacAcceptance(
    path.join(evidence, "macos"),
    command,
    Bun.env["TASKNOTES_UITEST_IDENTITY"],
  );
  requireStableSources(sources, await inputs());
  assert.equal(
    (await command(["git", "rev-parse", "HEAD"], true, workspace)).trim(),
    sourceHead,
  );
  const products = path.join(evidence, "macos/Build/Products"),
    files: MacArtifact["files"] = {},
    links: MacArtifact["links"] = {};
  for await (const file of new Bun.Glob("**/*").scan({
    cwd: products,
    onlyFiles: false,
    dot: true,
  })) {
    const absolute = path.join(products, file),
      metadata = await lstat(absolute);
    if (metadata.isSymbolicLink()) links[file] = await readlink(absolute);
    else if (metadata.isFile())
      files[file] = {
        sha256: await macFileSHA(absolute),
        mode: metadata.mode & 0o777,
      };
  }
  const artifact = readMacArtifact({
    schemaVersion: 1,
    runID: path.basename(evidence),
    packageRoot: root,
    sourceHead,
    xcodeVersion: await command(["xcodebuild", "-version"], true),
    sources,
    files,
    links,
  });
  await verifyMacArtifact(artifact, products, command);
  requireStableSources(sources, await inputs());
  assert.equal(
    (await command(["git", "rev-parse", "HEAD"], true, workspace)).trim(),
    sourceHead,
  );
  await Bun.write(
    path.join(evidence, "artifact.json"),
    JSON.stringify(artifact),
  );
  return artifact;
}

export async function runMacAcceptanceCase(
  run: {
    evidence: string;
    testRun: string;
    result: string;
    selector: string;
    maximumSeconds: 120 | 180;
  },
  command: MacJourneyCommand,
): Promise<void> {
  await requireUnlockedMac(
    path.join(run.evidence, "session-preflight.json"),
    command,
  );
  await command([
    "xcodebuild",
    "test-without-building",
    "-xctestrun",
    run.testRun,
    "-destination",
    "platform=macOS",
    "-parallel-testing-enabled",
    "NO",
    "-resultBundlePath",
    run.result,
    "-collect-test-diagnostics",
    "never",
    "-test-timeouts-enabled",
    "YES",
    "-maximum-test-execution-time-allowance",
    String(run.maximumSeconds),
    `-only-testing:${run.selector}`,
  ]);
}

/** Both isolated journeys build the same signed product; callers retain their deadlines. */
export async function buildMacAcceptance(
  derived: string,
  command: MacJourneyCommand,
  signingIdentity: string | undefined,
): Promise<void> {
  await command(["bun", "run", "mac:preflight"]);
  await command(["xcodegen", "generate"]);
  await command([
    "xcodebuild",
    "build-for-testing",
    "-project",
    "TaskNotes.xcodeproj",
    "-scheme",
    "TaskNotesAcceptance",
    "-configuration",
    "Debug",
    "-derivedDataPath",
    derived,
    "-destination",
    "platform=macOS",
    "-parallel-testing-enabled",
    "NO",
    "-jobs",
    "2",
    ...acceptanceSigningArguments(signingIdentity),
  ]);
}

export async function createMacAcceptanceState(
  state: string,
  descriptor: string,
  runID: string,
): Promise<void> {
  await mkdir(path.dirname(state), { recursive: true, mode: 0o700 });
  await mkdir(state, { recursive: false, mode: 0o700 });
  await Bun.write(
    descriptor,
    JSON.stringify({ schemaVersion: 1, runID, stateDirectory: state }),
  );
}

export async function macAcceptanceTestRun(derived: string): Promise<string> {
  const testRuns = await Array.fromAsync(
    new Bun.Glob("*.xctestrun").scan({
      cwd: path.join(derived, "Build/Products"),
      absolute: true,
    }),
  );
  assert.equal(testRuns.length, 1);
  const testRun = testRuns[0];
  assert.ok(testRun);
  return testRun;
}

export async function configureMacAcceptanceTestRun(
  testRun: string,
  environment: Record<string, string>,
  command: MacJourneyCommand,
): Promise<void> {
  for (const [key, value] of Object.entries(environment)) {
    await command([
      "plutil",
      "-replace",
      `TaskNotesAcceptanceUITests.EnvironmentVariables.${key}`,
      "-string",
      value,
      testRun,
    ]);
  }
  for (const [key, value] of [
    ["SystemAttachmentLifetime", "keepNever"],
    ["UserAttachmentLifetime", "keepAlways"],
  ] as const) {
    await command([
      "plutil",
      "-replace",
      `TaskNotesAcceptanceUITests.${key}`,
      "-string",
      value,
      testRun,
    ]);
  }
}

/** Attempt both evidence paths even when one fails, retaining every failure. */
export async function retainMacAcceptanceEvidence(
  state: string,
  result: string,
  evidence: string,
  command: MacJourneyCommand,
): Promise<unknown[]> {
  const failures: unknown[] = [];
  for (const retain of [
    () =>
      cp(state, path.join(evidence, "state"), {
        recursive: true,
        errorOnExist: true,
        force: false,
      }),
    async () => {
      if (await Bun.file(path.join(result, "Info.plist")).exists())
        await command([
          "xcrun",
          "xcresulttool",
          "export",
          "attachments",
          "--path",
          result,
          "--output-path",
          path.join(evidence, "screenshots"),
        ]);
    },
  ]) {
    try {
      await retain();
    } catch (error) {
      failures.push(error);
    }
  }
  return failures;
}

export async function recordMacAcceptanceOutcome(
  receipt: Record<string, unknown>,
  failures: unknown[],
  evidence: string,
  failureMessage: string,
): Promise<void> {
  await Bun.write(
    path.join(evidence, "run.json"),
    JSON.stringify(
      {
        ...receipt,
        status: failures.some(isMacSessionPreflightFailure)
          ? "blocked"
          : failures.length === 0
            ? "passed"
            : "failed",
      },
      null,
      2,
    ),
  );
  if (failures.length > 0) throw new AggregateError(failures, failureMessage);
}
