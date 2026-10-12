import { DiscordGuildIdSchema, type DiscordGuildId } from "@scout-for-lol/data";
import { prepareNotificationPresentation } from "#src/temporal/notification/notification-presentation.ts";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import {
  ScoutNotificationRenderResultSchema,
  type ScoutNotificationRenderResult,
} from "@scout-for-lol/temporal/activity-contracts";
import {
  type ScoutIntentRef,
  type ScoutDurableCommit,
} from "@scout-for-lol/temporal/pipeline-contracts";
import { prisma } from "#src/database/index.ts";
import { recordReceipt } from "#src/database/durable/receipt-repository.ts";
import { buildReceipt } from "#src/report-lake/durable-receipts.ts";
import { saveToS3 } from "#src/storage/s3-helpers.ts";
import type { StoredObject } from "#src/storage/object-integrity.ts";
import { requireIntentRecord } from "#src/temporal/notification-lane/notification-reads.ts";
import type { NotificationIntentKind } from "@scout-for-lol/domain/notifications/intent.ts";
import {
  runGuardedEffect,
  type ScoutEffectFence,
} from "#src/temporal/effect-fence.ts";
import { durableCommit } from "#src/temporal/match/match-commits.ts";
import {
  renderPostmatchNotification,
  type ScoutPostmatchRenderMode,
} from "#src/temporal/notification/postmatch-notification.ts";
import { renderPrematchNotification } from "#src/temporal/notification/prematch-notification.ts";
import {
  readNotificationArtifact,
  scoutNotificationRenderEvidenceCodec,
  scoutNotificationRenderReceiptKind,
  type ScoutAttestedObject,
  type ScoutNotificationRenderEvidence,
} from "#src/temporal/notification-lane/notification-receipts.ts";

/**
 * Render this match's notification image once, commit it, and attest to it.
 *
 * Which image is the intent's KIND's decision: a `postmatch` intent renders
 * v1's post-match report from the MatchV5 payload, a `prematch` intent
 * renders the loading screen from the archived spectator snapshot (see
 * `notification/prematch-notification.ts`). One receipt kind covers both,
 * because a receipt is per match and a match has at most one image per
 * kind of announcement in flight at a time.
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
 * `deliverNotification` READS this artifact back. It resolves the receipt,
 * fetches the objects, verifies the bytes against the attested digests and
 * sizes (`notification/notification-artifact.ts`), and rebuilds the message
 * from the receipt and those bytes with v1's own furniture builders — so the
 * delivered message is the attested one, byte for byte and word for word,
 * and the send never renders, never runs the report generator, and never
 * touches a rank, a flag or a model. The receipt's claim ("this is what this
 * match's notifications deliver") is therefore true by construction rather
 * than by coincidence, and the Satori pass stays on `background`, which is
 * the whole point of the split. For a post-match report that means the
 * generator's side effects — the `MatchRankHistory` upsert and the single AI
 * review — happen exactly once per match, here, under the fence
 * (`notification/postmatch-notification.ts`).
 *
 * ## One render per (match, kind), however many children ask
 *
 * The match fan-out starts one notification child per channel, and every one
 * of them calls this Activity for the same match. Without serialization two
 * of them can both read "no receipt", both render, both PUT the same key and
 * then race to record one receipt — and the winner's receipt can attest the
 * bytes the loser overwrote, after which every delivery digest-mismatches
 * and terminates `content-unavailable`. So the read/render/PUT/receipt
 * sequence runs under `runGuardedEffect`, keyed on the artifact identity
 * `(match, kind)`: the leader renders with the PUT bounded by the fence's
 * signal and the receipt recorded before the fence releases; a follower that
 * acquires the fence afterwards finds the claim completed (or, on a takeover,
 * the receipt standing) and reports `reused` without rendering. The read
 * before the fence is only the cheap replay short-circuit.
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
 * Commit rendered bytes to the canonical store, under the asset name v1 uses
 * for the same image.
 *
 * For a post-match report that is `report.png`, so the artifact this attests
 * to is the object the existing report pipeline has always written rather
 * than a second copy under a V2-only name; the loading screen is
 * `loading-screen.png` beside it. See the module doc for why a missing
 * bucket is a failure here rather than the no-op it is on the v1 path.
 */
async function commitNotificationImage(
  riotMatchId: RiotMatchId,
  image: Uint8Array,
  asset: {
    assetType: string;
    metadata: Record<string, string>;
    /** The date the object key is filed under; the render's own when absent. */
    keyDate?: Date | undefined;
  },
  fence: ScoutEffectFence,
): Promise<StoredObject> {
  // The render above may have taken as long as Satori takes; the put must
  // not start on a fence this attempt no longer holds, and once started it is
  // cancelled — retries included — the moment the fence is about to lapse.
  await fence.assertHeld();
  const stored = await saveToS3({
    abortSignal: fence.signal,
    ...(asset.keyDate === undefined ? {} : { keyDate: asset.keyDate }),
    matchId: riotMatchId,
    assetType: asset.assetType,
    extension: "png",
    body: image,
    contentType: "image/png",
    metadata: { matchId: riotMatchId, format: "png", ...asset.metadata },
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
 * Attest to the committed artifact — or to there being none.
 *
 * The evidence omits `capturedAt` on purpose — see `notification-receipts.ts` —
 * so a byte-identical repeat is `already-applied` and genuinely means another
 * run committed the same artifact. Reporting `reused` for that is the truth.
 *
 * A `conflict` is a different statement entirely: the bytes under this match's
 * render receipt are NOT the bytes this run just committed. It is returned as
 * the effect's fact rather than thrown, because the fence is what decides what
 * a conflicting fact means — it fails the Activity non-retryably and leaves
 * the claim open so the drift stays visible, exactly as it does for settlement.
 */
async function attestNotificationArtifact(
  riotMatchId: RiotMatchId,
  kind: Exclude<NotificationIntentKind, "duel-status" | "dare-status">,
  evidence: ScoutNotificationRenderEvidence,
  presentation?: { guildId: DiscordGuildId; clashEnabled: boolean },
): Promise<ScoutDurableCommit> {
  return durableCommit(
    await recordReceipt(
      prisma,
      buildReceipt({
        matchId: riotMatchId,
        kind: scoutNotificationRenderReceiptKind(kind, presentation),
        ...(presentation === undefined
          ? {}
          : {
              scope: { kind: "guild", guildId: presentation.guildId } as const,
            }),
        recordedAt: new Date(),
        evidence: scoutNotificationRenderEvidenceCodec.serialize(evidence),
      }),
    ),
  );
}

function attestedObjectOf(stored: StoredObject): ScoutAttestedObject {
  return {
    objectKey: stored.key,
    digest: stored.digest,
    bytes: stored.bytes,
    contentType: stored.contentType,
  };
}

function imageEvidence(
  riotMatchId: RiotMatchId,
  stored: StoredObject,
): ScoutNotificationRenderEvidence {
  return { artifact: "image", riotMatchId, ...attestedObjectOf(stored) };
}

/**
 * The post-match report, rendered once through v1's generator and attested
 * whole: the image, the AI review's image when the match earned one, and the
 * message parts the delivery rebuilds around them. Two objects at most, each
 * committed under the fence; the receipt names both.
 */
async function renderPostmatchArtifact(
  riotMatchId: RiotMatchId,
  fence: ScoutEffectFence,
  mode: ScoutPostmatchRenderMode,
): Promise<ScoutNotificationRenderEvidence> {
  const rendered = await renderPostmatchNotification(riotMatchId, mode);
  const metadata = { queueId: String(rendered.queueId) };
  // A live render files its objects under the day it rendered, which is the
  // day of the game. A historical one files them under the game's own day,
  // beside the match's archived payload, so a retry that crosses midnight
  // writes the same key again rather than a second copy under another date.
  const keyDate =
    mode.kind === "historical" ? new Date(rendered.gameCreation) : undefined;
  const image = await commitNotificationImage(
    riotMatchId,
    rendered.image,
    { assetType: "report", metadata, keyDate },
    fence,
  );
  const review =
    rendered.review === undefined
      ? undefined
      : await commitNotificationImage(
          riotMatchId,
          rendered.review,
          { assetType: "ai-review", metadata, keyDate },
          fence,
        );
  return {
    artifact: "report",
    riotMatchId,
    image: attestedObjectOf(image),
    content: rendered.content,
    components: rendered.components,
    ...(review === undefined ? {} : { review: attestedObjectOf(review) }),
  };
}

/** The loading screen, rendered from the archived spectator snapshot. */
async function renderPrematchArtifact(
  riotMatchId: RiotMatchId,
  fence: ScoutEffectFence,
  presentation?: { guildId: DiscordGuildId; clashEnabled: boolean },
): Promise<ScoutNotificationRenderEvidence> {
  const rendered = await renderPrematchNotification(
    riotMatchId,
    presentation?.clashEnabled,
  );
  if (rendered.artifact === "none") {
    return { artifact: "none", riotMatchId, reason: rendered.reason };
  }
  const stored = await commitNotificationImage(
    riotMatchId,
    rendered.image,
    {
      assetType:
        presentation === undefined
          ? "loading-screen"
          : `loading-screen-guild-${presentation.guildId}-${presentation.clashEnabled ? "clash" : "ordinary"}`,
      metadata: {},
    },
    fence,
  );
  return imageEvidence(riotMatchId, stored);
}

/**
 * Render what the intent's KIND says it announces.
 *
 * The switch is exhaustive over `NotificationIntentKind`, so a kind added to
 * the domain has to be given a renderer before this compiles — which is the
 * property that keeps a prematch intent from ever being rendered as a
 * post-match report: the prematch arm reads the archived spectator snapshot
 * and nothing else. The two announcement kinds have no image: their message
 * is text and embeds built at the send from the intent's own payload, so
 * they attest `none` and nothing is committed to the store.
 */
async function renderByKind(
  kind: Exclude<NotificationIntentKind, "duel-status" | "dare-status">,
  riotMatchId: RiotMatchId,
  fence: ScoutEffectFence,
  options: {
    postmatchMode: ScoutPostmatchRenderMode;
    presentation:
      { guildId: DiscordGuildId; clashEnabled: boolean } | undefined;
  },
): Promise<ScoutNotificationRenderEvidence> {
  switch (kind) {
    case "postmatch":
      return await renderPostmatchArtifact(
        riotMatchId,
        fence,
        options.postmatchMode,
      );
    case "prematch":
      return await renderPrematchArtifact(
        riotMatchId,
        fence,
        options.presentation,
      );
    case "settlement":
    case "hall-record-break":
      return { artifact: "none", riotMatchId, reason: "text-only" };
  }
}

/** The claim one (match, kind) render is guarded under; see the module doc. */
export function notificationRenderEffectKey(
  riotMatchId: RiotMatchId,
  kind: Exclude<NotificationIntentKind, "duel-status" | "dare-status">,
  presentation?: { guildId: DiscordGuildId; clashEnabled: boolean },
): string {
  return `v2-notification-render:${kind}:${riotMatchId}${presentation === undefined ? "" : `:guild:${presentation.guildId}:${presentation.clashEnabled ? "clash" : "ordinary"}`}`;
}

const NOTIFICATION_RENDER_EFFECT_KIND = "v2-notification-render";

/** The standing receipt as the fence's takeover probe reports it. */
async function standingArtifact(
  riotMatchId: RiotMatchId,
  kind: Exclude<NotificationIntentKind, "duel-status" | "dare-status">,
  presentation?: { guildId: DiscordGuildId; clashEnabled: boolean },
): Promise<{ fact: ScoutDurableCommit; effects: number } | null> {
  const standing = await readNotificationArtifact(
    riotMatchId,
    kind,
    presentation,
  );
  return standing === null
    ? null
    : { fact: { outcome: "already-applied" }, effects: 0 };
}

export async function renderNotificationArtifact(
  input: ScoutIntentRef,
): Promise<ScoutNotificationRenderResult> {
  const record = await requireIntentRecord(input.intentKey);
  if ("duelId" in record || "dareId" in record) {
    // The versioned announcement on the intent is the whole status message.
    // There is no match artifact to render or attest under a Riot match ID.
    return ScoutNotificationRenderResultSchema.parse({ outcome: "rendered" });
  }
  if (
    record.intent.kind === "duel-status" ||
    record.intent.kind === "dare-status"
  ) {
    throw new Error(
      `Intent ${input.intentKey}: ${record.intent.kind} requires its own subject`,
    );
  }
  const presentation = await prepareNotificationPresentation(record);
  return ScoutNotificationRenderResultSchema.parse({
    outcome: await renderMatchNotificationArtifact({
      riotMatchId: record.matchId,
      kind: record.intent.kind,
      postmatchMode: { kind: "live" },
      ...(record.intent.kind === "prematch" &&
      presentation?.guildPrematchArtifact === true
        ? {
            presentation: {
              guildId: DiscordGuildIdSchema.parse(presentation.serverId),
              clashEnabled: presentation.clashEnabled,
            },
          }
        : {}),
    }),
  });
}

/**
 * The render itself, keyed by the artifact's identity `(match, kind)` alone.
 *
 * Every render of a match's artifact goes through here — an intent's, and the
 * silent post-match backfill's, which has no intent — so both read-gate on
 * the same receipt, serialize on the same fence key, and attest under the
 * same receipt kind. A backfill racing a live render for one match is
 * therefore the ordinary "two children asked at once" case: one renders, the
 * other reports `reused`, and one receipt stands.
 */
export async function renderMatchNotificationArtifact(args: {
  riotMatchId: RiotMatchId;
  kind: Exclude<NotificationIntentKind, "duel-status" | "dare-status">;
  postmatchMode: ScoutPostmatchRenderMode;
  presentation?: { guildId: DiscordGuildId; clashEnabled: boolean };
}): Promise<"rendered" | "reused"> {
  const { riotMatchId, kind } = args;
  if (
    (await readNotificationArtifact(riotMatchId, kind, args.presentation)) !==
    null
  ) {
    return "reused";
  }
  const guarded = await runGuardedEffect({
    key: notificationRenderEffectKey(riotMatchId, kind, args.presentation),
    kind: NOTIFICATION_RENDER_EFFECT_KIND,
    alreadyApplied: async () =>
      await standingArtifact(riotMatchId, kind, args.presentation),
    apply: async (fence) => {
      const evidence = await renderByKind(kind, riotMatchId, fence, {
        postmatchMode: args.postmatchMode,
        presentation: args.presentation,
      });
      // The receipt is the last write and lands before the fence releases; a
      // follower that acquires the fence after this sees the completed claim.
      await fence.assertHeld();
      const fact = await attestNotificationArtifact(
        riotMatchId,
        kind,
        evidence,
        args.presentation,
      );
      return { fact, effects: fact.outcome === "applied" ? 1 : 0 };
    },
  });
  return guarded.fact.outcome === "applied" ? "rendered" : "reused";
}
