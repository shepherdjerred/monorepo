import { deliveryOperationId } from "#shared/operation-id.ts";
import { z } from "zod";
import { DeliveryError } from "#domain/error.ts";
import { PipelineRevisionSchema } from "#shared/contract.ts";
import { required, wire } from "./delivery-records.ts";
import { version, type Transaction } from "./delivery-data.ts";
import { validateTrmnlSuccess } from "./trmnl-policy.ts";

/** Same deterministic identity used by the source-owned execution adapters. */
export function specializedOperationId(identity: string) {
  return deliveryOperationId(identity);
}

const ScoutAcceptanceSchema = z
  .object({
    adapter: z.literal("scout-site"),
    archiveArtifactId: z.string(),
    archiveDigest: z.string(),
    versionSetRevisionId: z.string(),
    bucket: z.string(),
  })
  .strict();
const BackupSchema = z.object({
  producer: z.literal("storm-independent-restore"),
  receiptSha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  backupUid: z.string().min(1),
  restoreUid: z.string().min(1),
  source: z.object({ claimUid: z.string().min(1) }),
  restored: z.object({ claimUid: z.string().min(1) }),
  wholeVolumeProofSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  originalUntouchedProofSha256: z.string().regex(/^[a-f0-9]{64}$/u),
});

function summary(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

export async function validateSpecializedSuccess(
  tx: Transaction,
  deployment: {
    id: string;
    kind: string;
    pipelineRevisionId: string;
    versionSetRevisionId: string;
  },
) {
  if (["adopt-worker", "retire-host"].includes(deployment.kind)) return;
  const pipeline = PipelineRevisionSchema.parse(
    wire(
      required(
        await tx.pipeline.findUnique({
          where: { id: deployment.pipelineRevisionId },
        }),
        "Pipeline",
      ),
    ),
  ).definition;
  await validateTrmnlSuccess(tx, { ...deployment, pipeline });
  if (pipeline.kind !== "argocd") return;
  const stages = await tx.stage.findMany({
    where: { deploymentId: deployment.id },
  });
  const evidence = await tx.evidence.findMany({
    where: { deploymentId: deployment.id },
  });
  if (pipeline.scoutSite !== undefined) {
    const site = pipeline.scoutSite;
    const selected = await version(tx, deployment.versionSetRevisionId);
    const archive = selected.components[site.archiveComponent];
    const expectedOperation = specializedOperationId(
      `${deployment.id}:scout-site`,
    );
    const completed = stages.some(
      (stage) =>
        stage.key === "scout-site" &&
        stage.status === "succeeded" &&
        stage.operationId === expectedOperation,
    );
    const accepted = evidence.some((entry) => {
      const parsed = ScoutAcceptanceSchema.safeParse(summary(entry.summary));
      return (
        entry.kind === "acceptance" &&
        entry.id.startsWith(`${deployment.id}/stage/scout-site/`) &&
        entry.operationId === expectedOperation &&
        parsed.success &&
        parsed.data.archiveArtifactId === archive?.id &&
        parsed.data.archiveDigest === archive.digest &&
        parsed.data.versionSetRevisionId === selected.id &&
        parsed.data.bucket === site.bucket
      );
    });
    if (!completed || !accepted)
      throw new DeliveryError(
        "INVALID",
        "Combined Scout success requires completed frontend activation and exact archive acceptance evidence under the backend release lock",
      );
  }
  if (
    pipeline.minecraftUpgrade !== undefined &&
    pipeline.minecraftUpgrade.releaseMode !== "retained-volume-restart"
  ) {
    const expectedOperation = specializedOperationId(
      `${deployment.id}:minecraft-preservation`,
    );
    const completed = stages.filter(
      (stage) =>
        /^minecraft-preservation-\d+$/u.test(stage.key) &&
        stage.status === "succeeded" &&
        stage.operationId === expectedOperation,
    );
    const backedUp = evidence.some((entry) => {
      const parsed = BackupSchema.safeParse(summary(entry.summary));
      return (
        entry.kind === "backup" &&
        entry.operationId === expectedOperation &&
        completed.some((stage) =>
          entry.id.startsWith(`${deployment.id}/stage/${stage.key}/`),
        ) &&
        parsed.success &&
        parsed.data.source.claimUid !== parsed.data.restored.claimUid
      );
    });
    if (!backedUp || completed.length === 0)
      throw new DeliveryError(
        "INVALID",
        "Minecraft success requires independently verified preservation evidence; player deferral is not a completed backup and restore proof",
      );
  }
}
