import { z } from "zod";
import { FileSchema, uuid, type Manifest } from "./model";

export const settingsPath = ".obsidian/plugins/tasknotes/data.json";

export function assertCurrentConfigurationProof(
  manifest: Manifest,
  value: unknown,
): void {
  if (
    manifest.cases["initial-download"] !== "pass" ||
    manifest.operations["reference-changes"] !== "pass"
  )
    throw new Error(
      "Run verify and reference-changes successfully in the current round before native journeys",
    );
  const proof = z
    .object({
      schemaVersion: z.literal(1),
      runID: uuid,
      round: z.number().int().min(1).max(3),
      changedPath: z.literal(settingsPath),
      expectedFingerprint: FileSchema,
    })
    .parse(value);
  if (proof.runID !== manifest.runID || proof.round !== manifest.round)
    throw new Error("Configuration proof belongs to another run or round");
  if (
    JSON.stringify(proof.expectedFingerprint) !==
    JSON.stringify(manifest.reference[settingsPath])
  )
    throw new Error(
      "Configuration proof does not match the current reference settings",
    );
}
