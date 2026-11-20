import type { z } from "zod";
import type {
  NotificationListSchema,
  NotificationPreferencesSchema,
  OperationListSchema,
} from "#shared/api.ts";
import type { Persona } from "#testing/fixture-api/personas.ts";
import { requestId } from "./requests.ts";
import { HOUR, MINUTE, ago, fixtureId } from "#testing/fixture-api/support.ts";
import { titleNamed } from "./titles.ts";

type NotificationList = z.input<typeof NotificationListSchema>;
type Notification = NotificationList[number];
type NotificationEvent = Notification["event"];
type Preferences = z.input<typeof NotificationPreferencesSchema>;
type OperationList = z.input<typeof OperationListSchema>;
type OperationStatus = OperationList[number]["status"];

type NotificationSeed = {
  kind: string;
  title: string | null;
  channel: string;
  state: string;
  providerStatus?: string;
  failureReason?: string;
  attempts?: number;
  event?: Partial<NotificationEvent>;
  ownerOnly?: boolean;
};

/** Every channel, delivery state, and failure the notifications page renders. */
const NOTIFICATIONS: readonly NotificationSeed[] = [
  {
    kind: "removal_warning",
    title: "The Expanse",
    channel: "in_app",
    state: "pending",
    attempts: 0,
  },
  {
    kind: "media_available",
    title: "Dune: Part Two",
    channel: "email",
    state: "accepted",
    providerStatus: "delivered",
  },
  {
    kind: "media_upgraded",
    title: "Dune: Part Two",
    channel: "discord",
    state: "accepted",
  },
  {
    kind: "subtitles_ready",
    title: "Parasite",
    channel: "email",
    state: "accepted",
    providerStatus: "sent",
  },
  {
    kind: "interest_check",
    title: "The Bear",
    channel: "email",
    state: "sending",
    event: { interestRequestId: requestId(2), interestRevision: 2 },
  },
  {
    kind: "interest_check",
    title: "Slow Horses",
    channel: "email",
    state: "accepted",
    providerStatus: "bounced",
    event: { interestRequestId: requestId(5), interestRevision: 2 },
  },
  {
    kind: "acquisition_failed",
    title: "Anora",
    channel: "email",
    state: "failed",
    failureReason: "provider_rejected",
    attempts: 2,
  },
  {
    kind: "files_quarantined",
    title: "The Holdovers",
    channel: "discord_shared",
    state: "accepted",
  },
  {
    kind: "files_purged",
    title: "Moonlight",
    channel: "email",
    state: "accepted",
    providerStatus: "delivered",
  },
  {
    kind: "owner_health",
    title: null,
    channel: "email",
    state: "accepted",
    providerStatus: "delivered",
    event: {
      healthReason: "legacy_writer_authority_revoked",
      healthState: "current",
    },
    ownerOnly: true,
  },
  {
    kind: "owner_health",
    title: null,
    channel: "discord",
    state: "accepted",
    event: {
      healthReason: "media_storage_authority_revoked",
      healthState: "superseded",
    },
    ownerOnly: true,
  },
  {
    kind: "system_intervention",
    title: "Severance",
    channel: "email",
    state: "unknown",
    ownerOnly: true,
  },
  {
    kind: "media_available",
    title: "Shōgun",
    channel: "email",
    state: "failed",
    failureReason: "authority_changed_before_send",
    attempts: 3,
  },
  {
    kind: "media_available",
    title: "The Bear",
    channel: "in_app",
    state: "accepted",
  },
  {
    kind: "subtitles_ready",
    title: "Spirited Away",
    channel: "discord",
    state: "accepted",
  },
];

export function notificationList(persona: Persona): NotificationList {
  return NOTIFICATIONS.filter(
    (seed) => persona === "owner" || seed.ownerOnly !== true,
  ).map((seed, index) => {
    const age = (index * 11 + 2) * HOUR;
    return {
      id: fixtureId(14, index + 1),
      channel: seed.channel,
      state: seed.state,
      version: (index % 3) + 1,
      failureReason: seed.failureReason ?? null,
      providerStatus: seed.providerStatus ?? null,
      attempts: seed.attempts ?? 1,
      acceptedAt: seed.state === "accepted" ? ago(age) : null,
      createdAt: ago(age + 3 * MINUTE),
      event: {
        mediaId: seed.title === null ? null : titleNamed(seed.title).id,
        kind: seed.kind,
        ...seed.event,
      },
    };
  });
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
