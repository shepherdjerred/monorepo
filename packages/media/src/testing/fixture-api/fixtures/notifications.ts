import type { z } from "zod";
import type {
  NotificationListSchema,
  NotificationPreferencesSchema,
  OperationListSchema,
} from "#shared/api.ts";
import type { Persona } from "#testing/fixture-api/personas.ts";
import { requestId } from "./requests.ts";
import { HOUR, MINUTE, ago, fixtureId } from "#testing/fixture-api/support.ts";
import { mediaReference } from "./artwork.ts";
import { episodeItem, titleItem, titleNamed } from "./titles.ts";

type NotificationList = z.input<typeof NotificationListSchema>;
type Notification = NotificationList[number];
type NotificationEvent = Notification["event"];
type Preferences = z.input<typeof NotificationPreferencesSchema>;
type OperationList = z.input<typeof OperationListSchema>;
type OperationStatus = OperationList[number]["status"];

type DeliverySeed = {
  channel: string;
  state: string;
  providerStatus?: string;
  failureReason?: string;
  attempts?: number;
};

type EventSeed = {
  kind: string;
  /** The title the event is about; null for an event about no title. */
  title: string | null;
  /** The event is about this episode of the title's first season. */
  episode?: number;
  event?: Partial<NotificationEvent>;
  ownerOnly?: boolean;
  /** One row per channel the event was delivered on. */
  deliveries: readonly DeliverySeed[];
};

/** A title that was deleted after its last event was recorded. */
const DELETED_TITLE_ID = fixtureId(2, 9999);

/**
 * Every channel, delivery state, and failure the notifications page renders.
 * Two events reached their recipient on two channels, two are about an
 * episode, and some name no title: account email, owner health, and a title
 * that no longer exists.
 */
const EVENTS: readonly EventSeed[] = [
  {
    kind: "removal_warning",
    title: "The Expanse",
    deliveries: [{ channel: "in_app", state: "pending", attempts: 0 }],
  },
  {
    kind: "media_available",
    title: "Dune: Part Two",
    deliveries: [
      { channel: "email", state: "accepted", providerStatus: "delivered" },
      { channel: "discord", state: "accepted" },
    ],
  },
  {
    kind: "media_upgraded",
    title: "Dune: Part Two",
    deliveries: [{ channel: "discord", state: "accepted" }],
  },
  {
    kind: "subtitles_ready",
    title: "Parasite",
    deliveries: [
      { channel: "email", state: "accepted", providerStatus: "sent" },
    ],
  },
  {
    kind: "interest_check",
    title: "The Bear",
    event: { interestRequestId: requestId(2), interestRevision: 2 },
    deliveries: [{ channel: "email", state: "sending" }],
  },
  {
    kind: "interest_check",
    title: "Slow Horses",
    event: { interestRequestId: requestId(5), interestRevision: 2 },
    deliveries: [
      { channel: "email", state: "accepted", providerStatus: "bounced" },
    ],
  },
  {
    kind: "acquisition_failed",
    title: "Anora",
    deliveries: [
      {
        channel: "email",
        state: "failed",
        failureReason: "provider_rejected",
        attempts: 2,
      },
    ],
  },
  {
    kind: "files_quarantined",
    title: "The Holdovers",
    deliveries: [{ channel: "discord_shared", state: "accepted" }],
  },
  {
    kind: "files_purged",
    title: "Moonlight",
    deliveries: [
      { channel: "email", state: "accepted", providerStatus: "delivered" },
    ],
  },
  {
    kind: "files_purged",
    title: null,
    event: { mediaId: DELETED_TITLE_ID },
    deliveries: [
      { channel: "email", state: "accepted", providerStatus: "delivered" },
      { channel: "discord", state: "accepted" },
    ],
  },
  {
    kind: "owner_health",
    title: null,
    event: {
      healthReason: "legacy_writer_authority_revoked",
      healthState: "current",
    },
    ownerOnly: true,
    deliveries: [
      { channel: "email", state: "accepted", providerStatus: "delivered" },
    ],
  },
  {
    kind: "owner_health",
    title: null,
    event: {
      healthReason: "media_storage_authority_revoked",
      healthState: "superseded",
    },
    ownerOnly: true,
    deliveries: [{ channel: "discord", state: "accepted" }],
  },
  {
    kind: "system_intervention",
    title: "Severance",
    ownerOnly: true,
    deliveries: [{ channel: "email", state: "unknown" }],
  },
  {
    kind: "media_available",
    title: "Shōgun",
    episode: 4,
    deliveries: [
      {
        channel: "email",
        state: "failed",
        failureReason: "authority_changed_before_send",
        attempts: 3,
      },
    ],
  },
  {
    kind: "media_available",
    title: "The Bear",
    episode: 7,
    deliveries: [{ channel: "in_app", state: "accepted" }],
  },
  {
    kind: "subtitles_ready",
    title: "Spirited Away",
    deliveries: [{ channel: "discord", state: "accepted" }],
  },
  {
    kind: "email_verification",
    title: null,
    deliveries: [
      { channel: "email", state: "accepted", providerStatus: "delivered" },
    ],
  },
];

/** The item an event is about, and how its row refers to it. */
function eventMedia(
  seed: EventSeed,
): Pick<NotificationEvent, "mediaId" | "media"> {
  if (seed.title === null) {
    return { mediaId: null, media: null };
  }
  const title = titleNamed(seed.title);
  const media = mediaReference(
    title,
    seed.episode === undefined
      ? titleItem(title)
      : episodeItem(title, 1, seed.episode),
  );
  return { mediaId: media.id, media };
}

/** One row per delivery, newest event first; an event's rows share its id. */
export function notificationList(persona: Persona): NotificationList {
  return EVENTS.map((seed, index) => ({ seed, index }))
    .filter(({ seed }) => persona === "owner" || seed.ownerOnly !== true)
    .flatMap(({ seed, index }) => {
      const age = (index * 11 + 2) * HOUR;
      const event = {
        id: fixtureId(20, index + 1),
        ...eventMedia(seed),
        kind: seed.kind,
        ...seed.event,
      };
      return seed.deliveries.map((delivery) => ({ delivery, age, event }));
    })
    .map(({ delivery, age, event }, index) => ({
      id: fixtureId(14, index + 1),
      channel: delivery.channel,
      state: delivery.state,
      version: (index % 3) + 1,
      failureReason: delivery.failureReason ?? null,
      providerStatus: delivery.providerStatus ?? null,
      attempts: delivery.attempts ?? 1,
      acceptedAt: delivery.state === "accepted" ? ago(age) : null,
      createdAt: ago(age + 3 * MINUTE),
      event,
    }));
}

export function notificationPreferences(persona: Persona): Preferences {
  const owner = persona === "owner";
  return {
    email: owner ? "owner@example.com" : "mei@example.com",
    emailVerified: true,
    discordLinked: owner,
    discordAvailable: true,
    emailEnabled: true,
    discordEnabled: owner,
    upgrades: false,
    removalCompleted: true,
    version: 4,
  };
}

type OperationSeed = readonly [
  kind: string,
  title: string | null,
  status: OperationStatus,
  minutesAgo: number,
];

/** Recent background work, newest first, across every operation status. */
const OPERATIONS: readonly OperationSeed[] = [
  ["maintain_torrent", "Severance", "running", 2],
  ["acquire_subtitles", "Dune: Part Two", "running", 6],
  ["reconcile_media", "Severance", "queued", 9],
  ["import", "Andor", "running", 14],
  ["acquisition", "Arrival", "running", 31],
  ["deliver_notification", null, "completed", 44],
  ["acquisition", "Anora", "failed", 125],
  ["expand_request", "Frieren: Beyond Journey's End", "reconciling", 180],
  ["quarantine", "The Holdovers", "completed", 300],
  ["cleanup_upgrade", "Dune: Part Two", "completed", 420],
  ["import", "Dune: Part Two", "completed", 440],
  ["acquisition", "Dune: Part Two", "completed", 540],
  ["acquire_subtitles", "Parasite", "failed", 660],
  ["restore_media", "Silo", "queued", 840],
  ["reconcile_media", "The Bear", "completed", 1200],
  ["deliver_notification", null, "failed", 1320],
  ["purge", "Moonlight", "completed", 1560],
  ["maintain_torrent", "Ted Lasso", "completed", 1800],
  ["acquisition", "Slow Horses", "reconciling", 1980],
  ["import", "The Last of Us", "running", 2100],
  ["reconcile_media", "Shōgun", "completed", 2400],
  ["prepare_subtitle_replacement", "Spirited Away", "completed", 2820],
  ["rollback", "Blade Runner 2049", "completed", 3120],
  ["plex_exclusion_recover", null, "completed", 3600],
  ["acquisition", "Princess Mononoke", "completed", 4260],
];

export function operationList(): OperationList {
  return OPERATIONS.map(([kind, title, status, minutesAgo], index) => {
    const mediaId = title === null ? null : titleNamed(title).id;
    return {
      id: fixtureId(11, index + 1),
      kind,
      targetId: mediaId,
      mediaId,
      status,
      createdAt: ago((minutesAgo + 12) * MINUTE),
      updatedAt: ago(minutesAgo * MINUTE),
    };
  });
}
