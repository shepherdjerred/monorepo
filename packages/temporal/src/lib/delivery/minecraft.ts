import { createHash } from "node:crypto";
import { z } from "zod";
import receiptContract from "homelab/src/minecraft-delivery-receipt.schema.json" with { type: "json" };
import eligibilityContract from "homelab/src/minecraft-delivery-eligibility.schema.json" with { type: "json" };
import type {
  DeploymentDetail,
  EvidenceInput,
} from "@shepherdjerred/delivery/contract";

type MinecraftDetail = Pick<
  DeploymentDetail,
  "pipeline" | "versionSet" | "previousAcceptedVersionSet"
> & {
  environment: Pick<DeploymentDetail["environment"], "application">;
  deployment: Pick<
    DeploymentDetail["deployment"],
    "id" | "kind" | "serviceId" | "environmentId"
  >;
};

// The JSON Schema is the cross-language authority. The second projection only
// supplies TypeScript field types after that complete contract has validated.
const ReceiptSchema = z.fromJSONSchema(
  z.looseObject({ type: z.literal("object") }).parse(receiptContract),
);
const StorageFields = z.object({
  claimUid: z.string(),
  volumeUid: z.string(),
  volumeSource: z.object({ driver: z.string(), volumeHandle: z.string() }),
});
const ReceiptFields = z.object({
  requestId: z.string(),
  completedAt: z.string(),
  candidateImage: z.string(),
  sourceImage: z.string(),
  backupUid: z.string(),
  restoreUid: z.string(),
  source: StorageFields,
  restored: StorageFields,
  wholeVolumeProofSha256: z.string(),
  originalUntouchedProofSha256: z.string(),
  candidate: z.object({
    podUid: z.string(),
    imageId: z.string(),
    gameplaySha256: z.string(),
    startupLogSha256: z.string(),
  }),
});
export const MinecraftPreservationResultSchema = z
  .object({
    requestId: z.uuid(),
    receiptJson: z.string().min(1).max(100_000),
    receiptSha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  })
  .strict();
const EligibilityContract = z.fromJSONSchema(
  z
    .looseObject({ oneOf: z.array(z.record(z.string(), z.unknown())) })
    .parse(eligibilityContract),
);
const EligibilityFields = z.discriminatedUnion("status", [
  z.object({ status: z.literal("eligible"), players: z.literal(0) }),
  z.object({
    status: z.literal("waiting"),
    reason: z.string(),
    players: z.number().optional(),
  }),
]);
export type MinecraftEligibility = z.infer<typeof EligibilityFields>;
export function parseMinecraftEligibility(
  input: unknown,
): MinecraftEligibility {
  return EligibilityFields.parse(EligibilityContract.parse(input));
}

function target(detail: MinecraftDetail) {
  const pipeline = detail.pipeline.definition;
  if (pipeline.kind !== "argocd" || pipeline.minecraftUpgrade === undefined)
    throw new Error("Pipeline is not a specialized Minecraft upgrade");
  if (
    detail.deployment.serviceId !== "minecraft" ||
    detail.deployment.environmentId !== "minecraft/tsmc" ||
    detail.environment.application !== "minecraft-tsmc" ||
    pipeline.application !== "minecraft-tsmc" ||
    pipeline.namespace !== "minecraft-tsmc"
  )
    throw new Error(
      "Minecraft upgrade is restricted to the reviewed TSMC target",
    );
  if (detail.deployment.kind === "rollback")
    throw new Error(
      "TSMC cannot reverse an image against a possibly migrated world; use the independent restoration procedure",
    );
  const component = pipeline.minecraftUpgrade.imageComponent;
  if (pipeline.artifactParameters["image.tag"] !== component)
    throw new Error(
      "TSMC must observe its exact selected runtime image binding",
    );
  const artifact = detail.versionSet.components[component];
  if (
    artifact?.kind !== "image" ||
    artifact.uri !== "docker.io/shepherdjerred/the-storm-server" ||
    !/^\w[\w.-]{0,127}$/u.test(artifact.version)
  )
    throw new Error("TSMC requires its canonical immutable image artifact");
  return { artifact, upgrade: pipeline.minecraftUpgrade };
}

/** Upstream minecraft concatenates repository + ':' + tag; never pass a full URI as tag. */
export function minecraftRuntimeImage(detail: MinecraftDetail): string {
  const { artifact } = target(detail);
  return `${artifact.uri}:${artifact.version}@${artifact.digest}`;
}

export function minecraftImageParameters(
  detail: MinecraftDetail,
): Record<string, string> {
  const pipeline = detail.pipeline.definition;
  if (pipeline.kind !== "argocd" || pipeline.minecraftUpgrade === undefined)
    return {};
  const { artifact } = target(detail);
  return {
    "image.repository": artifact.uri,
    "image.tag": `${artifact.version}@${artifact.digest}`,
  };
}

/** Accept only exact bytes returned by the request-owned reviewed controller runner. */
export function validateMinecraftPreservation(
  detail: MinecraftDetail,
  expectedRequestId: string,
  input: unknown,
  now = Date.now(),
): EvidenceInput[] {
  const { artifact, upgrade } = target(detail);
  const result = MinecraftPreservationResultSchema.parse(input);
  if (
    result.requestId !== expectedRequestId ||
    `sha256:${createHash("sha256").update(result.receiptJson).digest("hex")}` !==
      result.receiptSha256
  )
    throw new Error(
      "Minecraft controller receipt bytes or request identity changed",
    );
  const raw: unknown = JSON.parse(result.receiptJson);
  const receipt = ReceiptFields.parse(ReceiptSchema.parse(raw));
  const runtimeDigest = /sha256:[a-f0-9]{64}$/u.exec(
    receipt.candidate.imageId,
  )?.[0];
  const completedAt = Date.parse(receipt.completedAt);
  if (
    runtimeDigest === undefined ||
    receipt.requestId !== expectedRequestId ||
    receipt.candidateImage !== minecraftRuntimeImage(detail) ||
    ![artifact.digest, ...artifact.runtimeDigests].includes(runtimeDigest) ||
    !Number.isFinite(completedAt) ||
    completedAt > now + 60_000 ||
    now - completedAt > 30 * 60_000
  )
    throw new Error(
      "Minecraft preservation does not prove this fresh exact candidate",
    );
  if (
    receipt.source.claimUid === receipt.restored.claimUid ||
    receipt.source.volumeUid === receipt.restored.volumeUid ||
    receipt.source.volumeSource.driver !==
      receipt.restored.volumeSource.driver ||
    receipt.source.volumeSource.volumeHandle ===
      receipt.restored.volumeSource.volumeHandle
  )
    throw new Error("Minecraft preservation aliases production storage");
  const previous =
    detail.previousAcceptedVersionSet?.components[upgrade.imageComponent];
  if (
    previous !== undefined &&
    (previous.kind !== "image" ||
      !receipt.sourceImage.endsWith(`@${previous.digest}`))
  )
    throw new Error(
      "Preserved source differs from the frozen accepted TSMC image",
    );
  return [
    {
      kind: "backup",
      operationId: expectedRequestId,
      summary: JSON.stringify({
        producer: "storm-independent-restore",
        receiptSha256: result.receiptSha256,
        backupUid: receipt.backupUid,
        restoreUid: receipt.restoreUid,
        source: receipt.source,
        restored: receipt.restored,
        wholeVolumeProofSha256: receipt.wholeVolumeProofSha256,
        originalUntouchedProofSha256: receipt.originalUntouchedProofSha256,
      }),
    },
    {
      kind: "preflight",
      operationId: expectedRequestId,
      summary: JSON.stringify({
        candidateImage: receipt.candidateImage,
        completedAt: receipt.completedAt,
        candidate: receipt.candidate,
        scope: receiptContract.properties.scope.const,
      }),
    },
  ];
}
