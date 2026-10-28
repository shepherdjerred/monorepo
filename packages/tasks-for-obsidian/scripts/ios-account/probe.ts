import assert from "node:assert/strict";
import { lstat, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { readOwnedMacVMJSON } from "tasknotes-macos/scripts/apple-acceptance/mac-vm-export.ts";
import { runDirectory, type Manifest } from "../apple-sync-live/model";
import { fingerprintApp } from "../apple-sync-live/prepare";
import {
  acceptanceProvenance,
  assertUnchangedBuild,
} from "../apple-sync-live/ledger";
import {
  assertPrivateInputProof,
  assertPhaseProofPair,
  InputProbeProofSchema,
  scanPrivateInputEvidence,
  verifyPrivateInputEvidence,
} from "./leak-check";
import { executePrivateAccountSession } from "./run-session";
import { privateAccountSelector } from "./runtime";
import { inputArtifacts } from "./app-input-artifacts";

type Phase = "credentials" | "verification";
const proofRelative = (phase: Phase) =>
  `ios-account/${phase}-private-input-ready.json`;

export async function runIosAccountProbe(manifest: Manifest) {
  await runPhase(manifest, "credentials");
  const first = await requirePhase(manifest, "credentials");
  await runPhase(manifest, "verification", first.runnerFiles);
  await requireIosPrivateInputProof(manifest);
  return {
    runID: manifest.runID,
    status: "both-private-input-phases-ready",
    nativeCaseCount: 2,
    realAccountSubmits: 0,
    fixtureAccountSubmits: 1,
    verificationCodeSubmits: 0,
  };
}

async function runPhase(
  manifest: Manifest,
  phase: Phase,
  runnerFiles?: Record<string, string>,
) {
  const output = path.join(runDirectory(manifest.runID), proofRelative(phase));
  assert.equal(
    await Bun.file(output).exists(),
    false,
    "This run already has private input proof; do not repeat its UI probe",
  );
  const email = `facet-probe-${crypto.randomUUID()}@example.invalid`;
  const password = `Facet-private-probe-${crypto.randomUUID()}-q7!`;
  const code = String(
    100_000 +
      (z
        .number()
        .int()
        .nonnegative()
        .parse(crypto.getRandomValues(new Uint32Array(1))[0]) %
        900_000),
  );
  let scanned: Awaited<ReturnType<typeof scanPrivateInputEvidence>> | undefined;
  const observed = await executePrivateAccountSession(manifest, {
    operation: phase === "credentials" ? "probe" : "fixture-verification",
    ...(runnerFiles === undefined ? {} : { runnerFiles }),
    inspectEvidence: async (directory) => {
      scanned = await scanPrivateInputEvidence(
        directory,
        [email, password],
        phase === "verification" ? { phase, code } : undefined,
      );
    },
    action: async (session) => {
      assert.equal(
        session.stage,
        "credentials",
        "The synthetic probe requires a fresh credential form",
      );
      const filled = await session.fill({ email, password });
      if (phase === "verification") {
        await session.submit();
        await session.observe();
        assert.equal(session.stage, "verification");
        await session.fillVerification({
          waitUntilFresh: () => Promise.resolve(),
          issue: () => ({
            code,
            expiresAtUnixMilliseconds: Date.now() + 30_000,
          }),
        });
      }
      const finished = await session.finish();
      assert.equal(finished.submitActionCount, phase === "credentials" ? 0 : 1);
      return { ...filled, ...finished };
    },
  });
  const manifestFile = path.join(
    observed.evidence,
    "attachments/manifest.json",
  );
  const attachmentIndex = z
    .array(z.object({ attachments: z.tuple([]) }))
    .parse(JSON.parse(await readFile(manifestFile, "utf8")));
  for (const entry of attachmentIndex) {
    assert.equal(
      entry.attachments.length,
      0,
      "Account input cannot retain visual or activity attachments",
    );
  }
  assert.ok(scanned !== undefined, "Private input evidence was not scanned");
  const proof = InputProbeProofSchema.parse({
    schemaVersion: 2,
    phase,
    mode: phase === "credentials" ? "account" : "fixture-verification",
    verificationCodeSubmitActionCount: 0,
    kind: "ios-private-account-input-probe",
    runID: manifest.runID,
    probeID: observed.probeID,
    selector: privateAccountSelector,
    sourceHead: observed.sourceHead,
    sourceFiles: observed.sourceFiles,
    appFiles: observed.appFiles,
    runnerFiles: observed.runnerFiles,
    appInputFiles: observed.appInputFiles,
    status: "private-input-ready",
    nativeCaseCount: 1,
    disabledCheckpoints: 2,
    submitActionCount: phase === "credentials" ? 0 : 1,
    scannedRawEvidence: true,
    logAvailability: observed.retainedLogs.availability,
    consoleLog: observed.retainedLogs.consoleLog,
    decodedActivities: observed.retainedLogs.decodedActivities,
    exportedDiagnostics: observed.retainedLogs.exportedDiagnostics,
    attachmentsCount: 0,
    evidence: scanned.files,
  });
  await writeFile(output, JSON.stringify(proof, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  return {
    runID: manifest.runID,
    status: proof.status,
    nativeCaseCount: 1,
    submitActionCount: proof.submitActionCount,
    rawEvidenceFiles: Object.keys(scanned.files).length,
  };
}

/** No secret lookup is permitted until this exact source/Runner/evidence proof is re-read. */
export async function requireIosPrivateInputProof(manifest: Manifest) {
  const credentials = await requirePhase(manifest, "credentials");
  const verification = await requirePhase(manifest, "verification");
  return assertPhaseProofPair(credentials, verification);
}

async function requirePhase(manifest: Manifest, phase: Phase) {
  await assertUnchangedBuild(manifest);
  const directory = runDirectory(manifest.runID);
  const provenance = acceptanceProvenance(
    manifest,
    await Bun.file(path.join(directory, "provenance.json")).json(),
  );
  const runner = path.join(
    directory,
    "ios/Build/Products/Debug-iphonesimulator/TasksForObsidianUITests-Runner.app",
  );
  const runnerFiles = await fingerprintApp(runner);
  const proof = assertPrivateInputProof(
    await readOwnedMacVMJSON(path.join(directory, proofRelative(phase))),
    {
      phase,
      runID: manifest.runID,
      sourceHead: provenance.sourceHead,
      sourceFiles: provenance.sourceFiles,
      appFiles: await fingerprintApp(
        path.join(
          directory,
          "ios/Build/Products/Debug-iphonesimulator/TasksForObsidian.app",
        ),
      ),
      runnerFiles,
      appInputFiles: await inputArtifacts(manifest.runID),
    },
  );
  const evidence = path.join(directory, "ios-account/probes", proof.probeID);
  const metadata = await lstat(evidence);
  assert.ok(
    metadata.isDirectory() &&
      !metadata.isSymbolicLink() &&
      metadata.uid === process.getuid?.(),
  );
  await verifyPrivateInputEvidence(evidence, proof);
  return proof;
}
