import { z } from "zod";
import type { DeploymentDetail } from "@shepherdjerred/delivery/contract";
import { deliveryOperationId } from "./selection.ts";
import { minecraftRuntimeImage } from "./minecraft.ts";

/** A safe player deferral is not preservation proof and cannot authorize selecting the candidate. */
export function requireMinecraftPreservation(
  detail: DeploymentDetail,
  now = Date.now(),
): void {
  const requestId = deliveryOperationId(
    `${detail.deployment.id}:minecraft-preservation`,
  );
  if (
    !detail.stages.some(
      (stage) =>
        /^minecraft-preservation-\d+$/u.test(stage.key) &&
        stage.status === "succeeded" &&
        stage.operationId === requestId,
    )
  )
    throw new Error(
      "Minecraft source selection requires its completed preservation stage",
    );
  const backup = detail.evidence.find(
    (entry) => entry.kind === "backup" && entry.operationId === requestId,
  );
  if (backup === undefined)
    throw new Error(
      "Minecraft source selection lacks native backup and independent restore evidence",
    );
  z.object({
    producer: z.literal("storm-independent-restore"),
    receiptSha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    backupUid: z.string().min(1),
    restoreUid: z.string().min(1),
  }).parse(JSON.parse(backup.summary));
  const candidates = detail.evidence
    .filter(
      (entry) => entry.kind === "preflight" && entry.operationId === requestId,
    )
    .map((entry) =>
      z
        .object({
          candidateImage: z.string(),
          completedAt: z.iso.datetime({ offset: true }),
        })
        .safeParse(JSON.parse(entry.summary)),
    )
    .filter((entry) => entry.success);
  if (
    !candidates.some(
      (entry) =>
        entry.data.candidateImage === minecraftRuntimeImage(detail) &&
        now - Date.parse(entry.data.completedAt) <= 30 * 60_000 &&
        Date.parse(entry.data.completedAt) <= now + 60_000,
    )
  )
    throw new Error(
      "Minecraft source selection lacks fresh exact candidate compatibility evidence",
    );
}
