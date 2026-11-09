import { PutObjectCommand } from "@aws-sdk/client-s3";
import { reportReceiptStore } from "#activities/reports/report-object-store.ts";
import { promotionStoragePrefix } from "#activities/promotion/store.ts";

export async function savePromotionEvidence(
  targetId: string,
  occurrenceId: string,
  bytes: Uint8Array,
  discord: boolean,
) {
  const storage = reportReceiptStore();
  const key = `${promotionStoragePrefix()}/evidence/${targetId}/${encodeURIComponent(occurrenceId)}/${crypto.randomUUID()}.${discord ? "json" : "png"}`;
  await storage.client.send(
    new PutObjectCommand({
      Bucket: storage.bucket,
      Key: key,
      Body: bytes,
      ContentType: discord ? "application/json" : "image/png",
      IfNoneMatch: "*",
    }),
  );
  return key;
}
