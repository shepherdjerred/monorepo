import { AttachmentBuilder, type MessageCreateOptions } from "discord.js";
import { ApplicationFailure } from "@temporalio/common";
import { MatchIdSchema } from "@scout-for-lol/data";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import {
  ScoutNotificationRenderV2ResultSchema,
  type ScoutNotificationRenderV2Result,
} from "@scout-for-lol/temporal/activity-contracts-v2";
import type { ScoutIntentRefV2 } from "@scout-for-lol/temporal/contracts-v2";
import { prisma } from "#src/database/index.ts";
import { recordReceipt } from "#src/database/durable/receipt-repository.ts";
import { buildReceipt } from "#src/report-lake/durable-receipts.ts";
import { saveToS3 } from "#src/storage/s3-helpers.ts";
import type { StoredObject } from "#src/storage/object-integrity.ts";
import { generateMatchReport } from "#src/league/tasks/postmatch/match-report-generator.ts";
import { resolveScoutV2MatchContext } from "#src/temporal/v2/match-context.ts";
import { requireIntentRecordV2 } from "#src/temporal/v2/notification-reads.ts";
import {
  readNotificationArtifactV2,
  scoutV2NotificationRenderEvidenceCodec,
  SCOUT_V2_NOTIFICATION_RENDER_RECEIPT_KIND,
} from "#src/temporal/v2/notification-receipts.ts";

/**
 * Render this match's report once, commit it, and attest to it.
 *
 * The expensive half of a notification is the Satori pass and the PNG encode,
 * which is why this Activity runs on `background` while the send runs on
 * `realtime`: a slow render must never sit in front of a live match. Splitting
 * them across queues is also what forces the artifact into shared storage —
 * the two never share a process, let alone memory.
 *
 * The replay gate is the receipt, exactly as it is for the raw archive. A run
 * that finds one renders nothing and reports `reused`, which is the whole
 * point of the `rendered | reused` contract: several intents fan out from one
 * match, every one of them starts a notification child, and only the first
 * should pay for the image they all deliver.
 *
 * ## The other half of the split
 *
 * `deliverNotificationV2` READS this artifact back. It resolves the receipt,
 * fetches the object, verifies the bytes against the attested digest and size
 * (`notification/notification-artifact.ts`), and hands them to
 * `generateMatchReport` as its pre-rendered image — so the attachment on the
 * delivered message is the attested object, byte for byte, and the send never
 * renders. The receipt's claim ("this is what this match's notifications
 * deliver") is therefore true by construction rather than by coincidence,
 * and the Satori pass stays on `background`, which is the whole point of the
 * split.
 *
 * ## Why there is no bucketless path
 *
 * `saveToS3` answers `undefined` when no bucket is configured, and on the v1
 * path that is a harmless no-op because v1 sends what it just rendered. Here
 * it would be a lie: a `rendered` result with nothing committed is an
 * artifact the send cannot read back, and the split has no in-memory hand-off
 * to fall back to — the two Activities share neither a process nor a queue.
 * So a missing bucket fails this Activity (retryably, as the misconfiguration
 * it is) instead of reporting a render that produced nothing durable.
 */

/**
 * The bytes `generateMatchReport` attached, pulled back out of the message it
 * built.
 *
 * v1 renders and attaches in one step and has no seam for handing the image
 * back, so this reaches into the message rather than duplicating the queue
 * branching — Classic, Arena and Standard each render differently, and a second
 * copy of that decision would drift from the one the send actually uses.
 *
 * A message with no buffered attachment is a broken internal contract, not a
 * degraded mode: every report path attaches exactly one PNG, and committing an
 * artifact that is not the one delivered would make the receipt a lie.
 */
function reportImageBytes(
  message: MessageCreateOptions,
  riotMatchId: RiotMatchId,
): Uint8Array {
  for (const file of message.files ?? []) {
    if (!(file instanceof AttachmentBuilder)) continue;
    const attachment: unknown = file.attachment;
    if (attachment instanceof Uint8Array) return attachment;
  }
  throw new Error(
    `The report message for ${riotMatchId} carried no buffered image attachment, so there is nothing to commit`,
  );
}

/**
 * Commit the rendered bytes to the canonical store.
 *
 * The key is v1's `report.png`, so the artifact this attests to is the same
 * object the existing report pipeline has always written rather than a second
 * copy under a V2-only name. See the module doc for why a missing bucket is a
 * failure here rather than the no-op it is on the v1 path.
 */
async function commitReportImage(
  riotMatchId: RiotMatchId,
  image: Uint8Array,
  queueId: number,
): Promise<StoredObject> {
  const stored = await saveToS3({
    matchId: MatchIdSchema.parse(riotMatchId),
    assetType: "report",
    extension: "png",
    body: image,
    contentType: "image/png",
    metadata: {
      matchId: riotMatchId,
      queueId: String(queueId),
      format: "png",
    },
    logEmoji: "🖼️",
    logMessage: "Committing the V2 notification artifact",
    errorContext: "V2 notification artifact",
  });
  if (stored === undefined) {
    throw new Error(
      `Rendered ${riotMatchId} but no S3 bucket is configured, so the V2 notification artifact cannot be committed for its delivery to read back`,
    );
  }
  return stored;
}

/**
 * Attest to the committed artifact.
 *
 * The evidence omits `capturedAt` on purpose — see `notification-receipts.ts` —
 * so a byte-identical repeat is `already-applied` and genuinely means another
 * run committed the same artifact. Reporting `reused` for that is the truth.
 *
 * A `conflict` is a different statement entirely: the bytes under this match's
 * render receipt are NOT the bytes this run just committed, and a strict V2
 * Activity never reports success over a durable write that came back in
 * conflict. So it throws. The retry re-reads the receipt, finds the artifact
 * that stands, and returns `reused` — which is both the honest answer and the
 * one that lets the drift surface in the failure rather than be swallowed by a
 * result that claims a render nobody will deliver.
 */
async function attestReportImage(
  riotMatchId: RiotMatchId,
  stored: StoredObject,
): Promise<ScoutNotificationRenderV2Result> {
  const result = await recordReceipt(
    prisma,
    buildReceipt({
      matchId: riotMatchId,
      kind: SCOUT_V2_NOTIFICATION_RENDER_RECEIPT_KIND,
      recordedAt: new Date(),
      evidence: scoutV2NotificationRenderEvidenceCodec.serialize({
        riotMatchId,
        objectKey: stored.key,
        digest: stored.digest,
        bytes: stored.bytes,
        contentType: stored.contentType,
      }),
    }),
  );
  if (result.outcome === "conflict") {
    throw new Error(
      `Rendered ${riotMatchId} but its render receipt already attests to different bytes (${result.reason}); the committed artifact stands and this run reports nothing`,
    );
  }
  return ScoutNotificationRenderV2ResultSchema.parse({
    outcome: result.outcome === "applied" ? "rendered" : "reused",
  });
}

export async function renderNotificationArtifactV2(
  input: ScoutIntentRefV2,
): Promise<ScoutNotificationRenderV2Result> {
  const record = await requireIntentRecordV2(input.intentKey);
  const riotMatchId = record.matchId;

  if ((await readNotificationArtifactV2(riotMatchId)) !== null) {
    return ScoutNotificationRenderV2ResultSchema.parse({ outcome: "reused" });
  }

  const context = await resolveScoutV2MatchContext(riotMatchId);
  const message = await generateMatchReport(
    context.matchData,
    context.trackedPlayers,
    // No target guilds: a per-guild feature flag can only change the message a
    // particular channel receives, and the artifact committed here is the one
    // image every channel subscribed to this match delivers.
    { targetGuildIds: [] },
  );
  if (message === undefined) {
    // The report generator found no tracked player it could render. An intent
    // exists for this match, so that is a disagreement between the producer
    // that minted it and the renderer, and no retry resolves it.
    throw ApplicationFailure.nonRetryable(
      `No report could be rendered for ${riotMatchId} despite an intent naming it`,
      "MissingDomainRecord",
    );
  }

  const stored = await commitReportImage(
    riotMatchId,
    reportImageBytes(message, riotMatchId),
    context.matchData.info.queueId,
  );
  return await attestReportImage(riotMatchId, stored);
}
