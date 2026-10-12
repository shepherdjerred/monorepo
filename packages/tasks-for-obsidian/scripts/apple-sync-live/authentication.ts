import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  packageRoot,
  type Manifest,
  digest,
  runDirectory,
  atomicJSON,
  activeClients,
} from "./model";
import { command, save } from "./platform";

export async function authenticationFixtures(manifest: Manifest) {
  const directory = runDirectory(manifest.runID);
  const argv = [
    "swift",
    "test",
    "--filter",
    "FacetAccountHTTPTests|FacetAccountOwnershipTests|FacetAccountPresentationTests|FacetAccountSessionResumptionTests",
  ];
  const stdout = path.join(directory, "authentication-fixtures.stdout.log");
  const stderr = path.join(directory, "authentication-fixtures.stderr.log");
  await command(
    argv,
    path.resolve(packageRoot, "../tasknotes-macos"),
    {},
    { logFile: stdout, stderrLogFile: stderr, timeoutMS: 900_000 },
  );
  const output = `${await Bun.file(stdout).text()}\n${await Bun.file(stderr).text()}`;
  const count = assertAuthenticationFixtureOutput(output);
  const rustArgv = [
    "cargo",
    "test",
    "--locked",
    "-p",
    "obsidian-sync",
    "--test",
    "protocol",
    "authentication_challenges_and_managed_shared_vaults_are_typed",
    "--",
    "--nocapture",
  ];
  const rustLog = path.join(directory, "authentication-core-fixtures.log");
  await command(
    rustArgv,
    path.resolve(packageRoot, "../tasknotes-core"),
    {},
    rustLog,
  );
  const rustOutput = await Bun.file(rustLog).text();
  if (!rustOutput.includes("1 passed; 0 failed"))
    throw new Error("Core authentication challenge fixture did not execute");
  manifest.cases["authentication-failures"] = "pass";
  await save(manifest);
  await atomicJSON(path.join(directory, "authentication-fixtures.json"), {
    schemaVersion: 1,
    runID: manifest.runID,
    classification: "fixtures-only",
    clients: activeClients(manifest),
    argv,
    testCount: count,
    stdoutSHA256: digest(await readFile(stdout)),
    stderrSHA256: digest(await readFile(stderr)),
    rustArgv,
    rustLogSHA256: digest(rustOutput),
    liveMFA: "only if already enabled; owner checkpoint",
  });
}

function swiftTestingCount(lines: string[]): number {
  let running = false;
  let count = 0;
  for (const line of lines) {
    if (line === "◇ Test run started.") {
      if (running)
        throw new Error("Authentication fixture target did not finish");
      running = true;
    } else if (/^(?:[✔✘◇] )?Test run with /u.test(line)) {
      const summary =
        /^✔ Test run with ([1-9]\d*) tests?(?: in [1-9]\d* suites?)? passed after \d+(?:\.\d+)? seconds?\.$/u.exec(
          line,
        );
      const targetCount = Number(summary?.[1]);
      if (!running || !Number.isSafeInteger(targetCount) || targetCount < 1)
        throw new Error(
          "Selected authentication fixture suites did not execute passing tests",
        );
      count += targetCount;
      if (!Number.isSafeInteger(count))
        throw new TypeError(
          "Authentication fixture test count exceeds safe bounds",
        );
      running = false;
    }
  }
  if (running || count === 0)
    throw new Error(
      "Authentication fixture targets did not finish passing tests",
    );
  return count;
}

export function assertAuthenticationFixtureOutput(output: string): number {
  const lines = output.split(/\r?\n/u);
  const selected = [
    "diagnosticsDistinguishPreflightAndPostRejectionWithoutContents",
    "verificationChallengeIsVisibleAndCredentialEditInvalidatesIt",
    "cancelledSignInDrainsAndResumesWithoutPublishingItsLateResponse",
    "oldProfileCredentialsCannotResumeUnderAnotherActiveAccount",
  ];
  if (
    lines.some((line) =>
      /^(?:[✔✘◇↷] )?(?:Test|Suite)\b.+\b(?:failed|skipped|ignored|issues?)\b/u.test(
        line,
      ),
    ) ||
    selected.some(
      (name) =>
        !lines.some((line) =>
          new RegExp(
            String.raw`^✔ Test ${name}\([^\r\n]*\) passed after \d+(?:\.\d+)? seconds?\.$`,
            "u",
          ).test(line),
        ),
    )
  )
    throw new Error(
      "Selected authentication fixture suites did not execute passing tests",
    );
  return swiftTestingCount(lines);
}
