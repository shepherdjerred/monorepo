import { z } from "zod";
import type { EvidenceInput } from "@shepherdjerred/delivery/contract";

export const StaticActivationReceiptSchema = z
  .object({
    deploymentId: z.string().min(1),
    versionSetRevisionId: z.string().min(1),
    archiveDigest: z.string().regex(/^sha256:[a-f\d]{64}$/u),
    bucket: z.string().min(1),
  })
  .strict();
export type StaticActivationReceipt = z.infer<
  typeof StaticActivationReceiptSchema
>;
export type StaticActivationEffects = {
  readReceipt: () => Promise<StaticActivationReceipt | null>;
  matchesArchive: () => Promise<boolean>;
  synchronize: () => Promise<void>;
  writeReceipt: (receipt: StaticActivationReceipt) => Promise<void>;
  purge: () => Promise<void>;
};

export function activationReceiptMatches(
  actual: StaticActivationReceipt | null,
  expected: StaticActivationReceipt,
): boolean {
  return (
    actual !== null &&
    actual.deploymentId === expected.deploymentId &&
    actual.versionSetRevisionId === expected.versionSetRevisionId &&
    actual.archiveDigest === expected.archiveDigest &&
    actual.bucket === expected.bucket
  );
}

/** Reserved runtime objects must never also be owned by a release archive. */
export function assertNoReservedStaticFiles(
  files: string[],
  exclusions: string[],
): void {
  for (const pattern of exclusions) {
    const prefix = pattern.endsWith("*") ? pattern.slice(0, -1) : pattern;
    if (prefix === "" || /[?*[\]]/u.test(prefix))
      throw new Error(
        "Static preservation rules must name an exact file or a literal prefix ending in *",
      );
    const overlap = files.find((file) =>
      pattern.endsWith("*") ? file.startsWith(prefix) : file === prefix,
    );
    if (overlap !== undefined)
      throw new Error(
        `Static archive contains runtime-owned object ${overlap}`,
      );
  }
}

/** No write retries: a lost response remains owned by the current deployment. */
export async function activateStaticArchive(
  receipt: StaticActivationReceipt,
  effects: StaticActivationEffects,
): Promise<void> {
  if (activationReceiptMatches(await effects.readReceipt(), receipt)) {
    if (!(await effects.matchesArchive()))
      throw new Error(
        "Static activation receipt exists but deployed bytes differ; operator recovery required",
      );
    await effects.purge();
    return;
  }
  await effects.synchronize();
  if (!(await effects.matchesArchive()))
    throw new Error(
      "Static release readback differs from the selected archive",
    );
  await effects.writeReceipt(receipt);
  if (!activationReceiptMatches(await effects.readReceipt(), receipt))
    throw new Error(
      "Static activation receipt is unconfirmed; inspect before retrying",
    );
  await effects.purge();
}

export function staticAcceptanceEvidence(
  receipt: StaticActivationReceipt,
  url: string,
): EvidenceInput[] {
  return [
    {
      kind: "reconciliation",
      summary:
        "Owned static activation receipt and all selected archive bytes match the exact release",
      operationId: receipt.deploymentId,
    },
    {
      kind: "runtime",
      summary:
        "All selected static objects match the immutable archive by bytes",
      operationId: receipt.deploymentId,
    },
    {
      kind: "acceptance",
      summary:
        "Public entrypoints and deployment receipt match the selected release",
      url,
      operationId: receipt.deploymentId,
    },
  ];
}
