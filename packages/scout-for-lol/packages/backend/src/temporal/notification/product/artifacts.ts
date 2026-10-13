import { AttachmentBuilder, type MessageCreateOptions } from "discord.js";
import configuration from "#src/configuration.ts";
import { createS3Client } from "#src/storage/s3-client.ts";
import {
  computeSha256Digest,
  putContentAddressedObject,
} from "#src/storage/object-integrity.ts";
import { readVerifiedRawObjectBytes } from "#src/report-store/s3-raw-source.ts";
import { NotificationMessageSnapshotSchema } from "#src/temporal/notification/notification-presentation.ts";
import {
  FrozenAnnouncementArtifactSchema,
  productAnnouncementOf,
  type FrozenAnnouncementArtifact,
} from "#src/temporal/notification/product/announcement.ts";
import type { ProductNotificationIntentRecord } from "#src/database/durable/intent-row.ts";
import { UndeliverableContentError } from "#src/temporal/notification/undeliverable-content.ts";

function announcementBucket(): string {
  const bucket = configuration.s3BucketName;
  if (bucket === undefined)
    throw new Error("Product announcements require the canonical S3 bucket");
  return bucket;
}

/** Content-addressed keys never replace a different occurrence's image. */
export async function freezeAnnouncementArtifact(
  bytes: Uint8Array,
  name: string,
): Promise<FrozenAnnouncementArtifact> {
  const digest = computeSha256Digest(bytes);
  const artifact = FrozenAnnouncementArtifactSchema.parse({
    key: `product-announcements/${digest}`,
    digest,
    bytes: bytes.length,
    name,
  });
  const client = createS3Client();
  try {
    await putContentAddressedObject({
      client,
      bucket: announcementBucket(),
      key: artifact.key,
      body: bytes,
      contentType: "image/png",
      metadata: {},
      errorContext: "frozen product announcement",
      retryContext: "product-announcement",
    });
    return artifact;
  } finally {
    client.destroy();
  }
}

class InvalidAnnouncementArtifactError extends UndeliverableContentError {}

export async function buildProductAnnouncementMessage(
  record: ProductNotificationIntentRecord,
  abortSignal: AbortSignal,
): Promise<MessageCreateOptions> {
  const announcement = productAnnouncementOf(record);
  const message = NotificationMessageSnapshotSchema.parse(
    JSON.parse(announcement.messageJson),
  );
  const files: AttachmentBuilder[] = [];
  if (announcement.artifacts.length > 0) {
    const client = createS3Client();
    try {
      for (const artifact of announcement.artifacts) {
        const bytes = await readVerifiedRawObjectBytes({
          client,
          bucket: announcementBucket(),
          key: artifact.key,
          expectedDigest: artifact.digest,
          options: { abortSignal },
        });
        if (bytes.length !== artifact.bytes)
          throw new InvalidAnnouncementArtifactError(
            `Artifact ${artifact.key} has contradictory size`,
          );
        files.push(
          new AttachmentBuilder(Buffer.from(bytes), { name: artifact.name }),
        );
      }
    } finally {
      client.destroy();
    }
  }
  return {
    content: message.content,
    embeds: message.embeds,
    components: message.components,
    files,
    allowedMentions: { parse: [] },
  };
}
