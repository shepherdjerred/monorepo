import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  atomicJSON,
  digest,
  requiredCases,
  provenancePaths,
  PendingCheckpoint,
  root,
  runDirectory,
  sha256,
  type Manifest,
} from "./model";
import { command, save } from "./platform";
import { waitForConvergence } from "./native";
import { fingerprintApp } from "./prepare";

export function assertRoundComplete(manifest: Manifest): void {
  if (manifest.failures.length > 0 || manifest.stage === "failed")
    throw new Error(
      "Failed acceptance history cannot be replaced with a passing retry",
    );
  if (
    requiredCases.some(
      (name) =>
        name !== "three-consecutive-runs" && manifest.cases[name] !== "pass",
    )
  )
    throw new PendingCheckpoint(
      "Every acceptance case must pass in the current round",
    );
  const previous = manifest.completedRounds.map((entry) => entry.round);
  const expected = Array.from(
    { length: manifest.round - 1 },
    (_, index) => index + 1,
  );
  if (JSON.stringify(previous) !== JSON.stringify(expected))
    throw new Error("Acceptance rounds must be consecutive");
}

export async function guardedStage(
  manifest: Manifest,
  operation: string,
  action: () => Promise<void>,
) {
  if (manifest.stage === "failed" || manifest.failures.length > 0)
    throw new Error(
      "This failed run is retained. Same-round retries cannot erase failure; prepare a new owned run after fixing the cause.",
    );
  if (manifest.operations[operation] !== undefined)
    throw new Error(
      "This stage already ran in this round; inspect its retained evidence",
    );
  const round = manifest.round;
  try {
    await action();
    if (manifest.round === round) manifest.operations[operation] = "pass";
    await save(manifest);
  } catch (error) {
    if (error instanceof PendingCheckpoint) {
      console.log(`Pending owner/scenario checkpoint: ${error.message}`);
      return;
    }
    manifest.operations[operation] = "failed";
    manifest.stage = "failed";
    manifest.failures.push({
      round: manifest.round,
      operation,
      capturedAt: new Date().toISOString(),
    });
    const cases: Record<string, (typeof requiredCases)[number][]> = {
      "seal-reference": ["official-reference"],
      verify: ["initial-download"],
      "reference-changes": [
        "file-operations",
        "binary-changes",
        "configuration",
      ],
      journeys: ["bidirectional-changes", "configuration"],
      offline: ["offline-recovery"],
      conflicts: ["concurrent-edits"],
      "lifecycle-begin": ["session-lifecycle"],
      "lifecycle-finish": ["session-lifecycle"],
      "authentication-fixtures": ["authentication-failures"],
      "official-ui": ["official-ui"],
      "complete-round": ["three-consecutive-runs"],
    };
    const name = operation.split(":")[0] ?? operation;
    for (const caseName of cases[name] ?? [])
      manifest.cases[caseName] = "failed";
    await save(manifest);
    throw error;
  }
}

async function assertUnchangedBuild(manifest: Manifest) {
  const directory = runDirectory(manifest.runID);
  const provenance = z
    .object({
      sourceFiles: z.record(z.string(), sha256),
      iosApp: z.record(z.string(), sha256),
      macApp: z.record(z.string(), sha256),
    })
    .parse(await Bun.file(path.join(directory, "provenance.json")).json());
  const listing = await command(
    [
      "git",
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      ...provenancePaths,
    ],
    root,
  );
  if (
    JSON.stringify(listing.split("\n").filter(Boolean).sort()) !==
    JSON.stringify(Object.keys(provenance.sourceFiles).sort())
  )
    throw new Error("Source inventory changed during the acceptance sequence");
  for (const [filename, expected] of Object.entries(provenance.sourceFiles)) {
    if (digest(await readFile(path.join(root, filename))) !== expected)
      throw new Error(
        "Source changed during the acceptance sequence; rebuild in a new run",
      );
  }
  for (const client of ["ios", "macos"] as const) {
    const app =
      client === "ios"
        ? "ios/Build/Products/Debug-iphonesimulator/TasksForObsidian.app"
        : "macos/Build/Products/Debug/FacetAcceptance.app";
    const actual = await fingerprintApp(path.join(directory, app));
    const expected = client === "ios" ? provenance.iosApp : provenance.macApp;
    if (JSON.stringify(actual) !== JSON.stringify(expected))
      throw new Error("Native artifact changed during the acceptance sequence");
  }
}

async function assertPriorEvidence(manifest: Manifest) {
  const directory = runDirectory(manifest.runID);
  for (const previous of manifest.completedRounds) {
    const bytes = await readFile(
      path.join(directory, `round-${String(previous.round)}-complete.json`),
    );
    if (digest(bytes) !== previous.evidenceSHA256)
      throw new Error("Archived acceptance evidence changed");
    const evidence = z
      .object({
        runID: z.literal(manifest.runID),
        round: z.literal(previous.round),
        cases: z.record(z.string(), z.string()),
      })
      .parse(JSON.parse(bytes.toString("utf8")));
    if (
      requiredCases.some(
        (name) =>
          name !== "three-consecutive-runs" && evidence.cases[name] !== "pass",
      )
    )
      throw new Error(
        "Archived round does not prove the complete acceptance matrix",
      );
  }
  const reference = z
    .object({
      runID: z.literal(manifest.runID),
      officialVersion: z.string(),
      pluginManifestSHA256: sha256,
    })
    .parse(
      await Bun.file(path.join(directory, "official-reference.json")).json(),
    );
  const pluginManifest = await readFile(
    path.join(
      directory,
      "reference-vault/.obsidian/plugins/tasknotes/manifest.json",
    ),
  );
  if (digest(pluginManifest) !== reference.pluginManifestSHA256)
    throw new Error("Installed official plugin changed during acceptance");
  const version = await command([
    "plutil",
    "-extract",
    "CFBundleShortVersionString",
    "raw",
    "-o",
    "-",
    "/Applications/Obsidian.app/Contents/Info.plist",
  ]);
  if (version !== reference.officialVersion)
    throw new Error("Official Obsidian changed during acceptance");
}

export async function completeRound(manifest: Manifest) {
  assertRoundComplete(manifest);
  await assertPriorEvidence(manifest);
  await assertUnchangedBuild(manifest);
  const clients = await waitForConvergence(manifest, manifest.reference);
  const directory = runDirectory(manifest.runID);
  const retained: Record<string, unknown> = {};
  for (const relative of new Bun.Glob("*.json").scanSync({ cwd: directory }))
    retained[relative] = z
      .unknown()
      .parse(await Bun.file(path.join(directory, relative)).json());
  const proof = {
    schemaVersion: 1,
    runID: manifest.runID,
    round: manifest.round,
    capturedAt: new Date().toISOString(),
    cases: { ...manifest.cases },
    clients,
    reference: manifest.reference,
    retained,
  };
  const proofFile = path.join(
    directory,
    `round-${String(manifest.round)}-complete.json`,
  );
  await atomicJSON(proofFile, proof);
  manifest.completedRounds.push({
    round: manifest.round,
    evidenceSHA256: digest(await readFile(proofFile)),
  });
  if (manifest.round === 3) {
    manifest.cases["three-consecutive-runs"] = "pass";
    console.log(
      "All required cases passed in three consecutive full rounds on unchanged native artifacts.",
    );
  } else {
    manifest.round += 1;
    manifest.operations = {};
    for (const name of requiredCases)
      if (name !== "official-reference") manifest.cases[name] = "pending";
    manifest.stage = "bound";
    console.log(
      `Round ${String(manifest.round)} is pending. Run verify for a fresh cold start, then every acceptance scenario again.`,
    );
  }
  await save(manifest);
}
