import { z } from "zod";
import contract from "@shepherdjerred/ops-model/minecraft-delivery-recovery.schema.json" with { type: "json" };
import { MinecraftControllerReceiptSchema } from "./minecraft-recovery-contract.ts";

const ReportContract = z.fromJSONSchema(
  z.looseObject({ type: z.literal("object") }).parse(contract),
);
const Identity = z.string().min(1);
const ReportFields = z.object({
  requestId: z.uuid(),
  observedAt: z.iso.datetime({ offset: true }),
  journalSha256: Identity,
  source: z.object({
    serverUid: Identity,
    resourceVersion: Identity,
    templateSha256: Identity,
    image: Identity,
    claimUid: Identity,
    claimResourceVersion: Identity,
    volumeName: Identity,
    volumeUid: Identity,
    volumeResourceVersion: Identity,
    volumeSource: z.object({ driver: Identity, volumeHandle: Identity }),
    replicas: z.number(),
  }),
  pods: z.array(
    z.object({
      uid: Identity,
      resourceVersion: Identity,
      image: Identity,
      ownerUid: Identity,
      claimName: Identity,
    }),
  ),
  routes: z.array(
    z.object({
      name: Identity,
      uid: Identity,
      resourceVersion: Identity,
      selectorSha256: Identity,
    }),
  ),
  application: z.object({
    uid: Identity,
    resourceVersion: Identity,
    sourceSha256: Identity,
    operationPhase: Identity,
  }),
});

/** The neutral JSON Schema validates every field before this typed projection. */
export function parseMinecraftRecoveryReport(input: unknown) {
  const report = ReportFields.parse(ReportContract.parse(input));
  if (new Set(report.routes.map((route) => route.name)).size !== 4)
    throw new Error(
      "Recovery must inspect each original TSMC route exactly once",
    );
  if (
    report.pods.length !== report.source.replicas ||
    report.pods.some(
      (pod) =>
        pod.ownerUid !== report.source.serverUid ||
        pod.image !== report.source.image,
    )
  )
    throw new Error(
      "Recovery Pod does not belong to the unchanged original server",
    );
  return report;
}

export const MinecraftRecoveryReportEnvelopeSchema = z
  .object({
    requestId: z.uuid(),
    controller: MinecraftControllerReceiptSchema,
    reportJson: z.string().min(1).max(100_000),
    reportSha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  })
  .strict();
