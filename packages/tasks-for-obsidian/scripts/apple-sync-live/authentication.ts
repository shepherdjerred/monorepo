import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  packageRoot,
  type Manifest,
  digest,
  runDirectory,
  atomicJSON,
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
    argv,
    testCount: count,
    stdoutSHA256: digest(await readFile(stdout)),
    stderrSHA256: digest(await readFile(stderr)),
    rustArgv,
    rustLogSHA256: digest(rustOutput),
    liveMFA: "only if already enabled; owner checkpoint",
  });
}

export function assertAuthenticationFixtureOutput(output: string): number {
  const summary = /Test run with ([1-9]\d*) tests?[\s\S]{0,200}passed/u.exec(
    output,
  );
  const selected = [
    "diagnosticsDistinguishPreflightAndPostRejectionWithoutContents",
    "verificationChallengeIsVisibleAndCredentialEditInvalidatesIt",
    "cancelledSignInDrainsAndResumesWithoutPublishingItsLateResponse",
    "oldProfileCredentialsCannotResumeUnderAnotherActiveAccount",
  ];
  if (
    summary?.[1] === undefined ||
    selected.some((name) => !output.includes(name))
  )
    throw new Error(
      "Selected authentication fixture suites did not execute passing tests",
    );
  return Number(summary[1]);
}
