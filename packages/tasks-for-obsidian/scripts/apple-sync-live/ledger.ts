import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  currentOfficialPlugin,
  currentOfficialVersion,
} from "./replicas/official";
import { readVaultFile } from "./replicas/access";
import { GuestExecutionSchema } from "./transport/contract";
import { verifyGuestLiveRun } from "./transport/execution/host";
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
  activeClients,
} from "./model";
import { command, save } from "./platform";
import { waitForConvergence } from "./native";
import { fingerprintApp } from "./prepare";
import { assertSealedOfficialPlugin } from "./official-plugin";
import { ArchiveLineageSchema } from "./reference-archive/contract";

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

export function acceptanceProvenance(manifest: Manifest, value: unknown) {
  const common = {
    runID: z.literal(manifest.runID),
    sourceHead: z.string().min(1),
    sourceFiles: z.record(z.string(), sha256),
    macApp: z.record(z.string(), sha256),
    pluginSettingsFixture: z.unknown(),
    expectedTaskNotesVersion: z.literal("4.13.8"),
    officialObsidianVersion: z.string().nullable(),
    referenceArchive: ArchiveLineageSchema.optional().refine(
      (lineage) =>
        JSON.stringify(lineage) === JSON.stringify(manifest.referenceArchive),
      "Reference archive lineage differs from the manifest",
    ),
  };
  if (manifest.schemaVersion === 3)
    return z
      .strictObject({
        ...common,
        schemaVersion: z.literal(3),
        scope: z.literal(manifest.scope),
        execution: GuestExecutionSchema,
        macAppDirectory: z.string(),
        ...(manifest.scope === "apple"
          ? { iosApp: z.record(z.string(), sha256) }
          : {}),
      })
      .parse(value);
  return manifest.schemaVersion === 2
    ? z
        .strictObject({
          ...common,
          schemaVersion: z.literal(2),
          scope: z.literal("macos"),
        })
        .parse(value)
    : z
        .strictObject({
          ...common,
          schemaVersion: z.literal(1),
          iosApp: z.record(z.string(), sha256),
        })
        .parse(value);
}

export async function assertUnchangedBuild(manifest: Manifest) {
  const directory = runDirectory(manifest.runID);
  const provenance = acceptanceProvenance(
    manifest,
    await Bun.file(path.join(directory, "provenance.json")).json(),
  );
  if (
    manifest.schemaVersion === 3 &&
    "execution" in provenance &&
    JSON.stringify(provenance.execution) !== JSON.stringify(manifest.execution)
  )
    throw new Error(
      "Guest execution binding changed during the acceptance sequence",
    );
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
  await verifyClientArtifacts(manifest, provenance);
}

async function verifyClientArtifacts(
  manifest: Manifest,
  provenance: ReturnType<typeof acceptanceProvenance>,
) {
  const directory = runDirectory(manifest.runID);
  for (const client of activeClients(manifest)) {
    if (client === "macos" && manifest.schemaVersion === 3) {
      await verifyGuestArtifact(manifest, provenance);
      continue;
    }
    const app =
      client === "ios"
        ? "ios/Build/Products/Debug-iphonesimulator/TasksForObsidian.app"
        : "macos/Build/Products/Debug/FacetAcceptance.app";
    const actual = await fingerprintApp(path.join(directory, app));
    const expected =
      client === "ios" && "iosApp" in provenance
        ? provenance.iosApp
        : provenance.macApp;
    if (JSON.stringify(actual) !== JSON.stringify(expected))
      throw new Error("Native artifact changed during the acceptance sequence");
  }
}

async function verifyGuestArtifact(
  manifest: Extract<Manifest, { schemaVersion: 3 }>,
  provenance: ReturnType<typeof acceptanceProvenance>,
) {
  if (!("macAppDirectory" in provenance))
    throw new Error("Missing prepared guest artifact path");
  const actual = await fingerprintApp(provenance.macAppDirectory);
  if (JSON.stringify(actual) !== JSON.stringify(provenance.macApp))
    throw new Error("Prepared guest app artifact changed");
  await verifyGuestLiveRun(manifest);
}

async function assertPriorEvidence(manifest: Manifest) {
  const directory = runDirectory(manifest.runID);
  for (const previous of manifest.completedRounds) {
    const bytes = await readFile(
      path.join(directory, `round-${String(previous.round)}-complete.json`),
    );
    if (digest(bytes) !== previous.evidenceSHA256)
      throw new Error("Archived acceptance evidence changed");
    const fields = {
      runID: z.literal(manifest.runID),
      round: z.literal(previous.round),
      cases: z.record(z.string(), z.string()),
    };
    const evidence = (
      manifest.schemaVersion === 3
        ? z.object({
            ...fields,
            schemaVersion: z.literal(3),
            scope: z.literal(manifest.scope),
            replicaCount: z.literal(activeClients(manifest).length + 1),
            execution: GuestExecutionSchema,
          })
        : manifest.schemaVersion === 2
          ? z.object({
              ...fields,
              schemaVersion: z.literal(2),
              scope: z.literal("macos"),
              replicaCount: z.literal(2),
            })
          : z.object({ ...fields, schemaVersion: z.literal(1) })
    ).parse(JSON.parse(bytes.toString("utf8")));
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
      pluginEvidence: z.unknown(),
    })
    .parse(
      await Bun.file(path.join(directory, "official-reference.json")).json(),
    );
  const pluginManifest = await readVaultFile(
    manifest,
    "official",
    ".obsidian/plugins/tasknotes/manifest.json",
  );
  if (digest(pluginManifest) !== reference.pluginManifestSHA256)
    throw new Error("Installed official plugin changed during acceptance");
  assertSealedOfficialPlugin(
    reference.pluginEvidence,
    await currentOfficialPlugin(manifest),
  );
  const version = await currentOfficialVersion(manifest);
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
    ...(manifest.schemaVersion === 3
      ? {
          schemaVersion: 3,
          scope: manifest.scope,
          replicaCount: activeClients(manifest).length + 1,
          execution: manifest.execution,
        }
      : manifest.schemaVersion === 2
        ? { schemaVersion: 2, scope: manifest.scope, replicaCount: 2 }
        : { schemaVersion: 1 }),
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
      `All required cases passed in three consecutive ${manifest.schemaVersion === 2 ? "Mac-only rounds (two replicas)" : "Apple rounds (three replicas)"} on unchanged native artifacts.`,
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
