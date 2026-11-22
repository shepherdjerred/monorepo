import type { MediaReference } from "#shared/household/media-reference.ts";
import type { Copy } from "./copy.ts";

/**
 * The events Media tells people about. `GET /api/v1/notifications` types an
 * event's kind as a string; these are the kinds it sends.
 */
export const NOTIFICATION_KINDS = [
  "media_available",
  "media_upgraded",
  "subtitles_ready",
  "files_quarantined",
  "files_purged",
  "acquisition_failed",
  "system_intervention",
  "interest_check",
  "retention_warning",
  "owner_health",
  "email_verification",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/**
 * What happened, as one sentence: about the title the event names, or about
 * no title in particular when it names none. An event that batches several
 * titles records only the first, so a sentence never says how many.
 */
export const NOTIFICATION_COPY = {
  media_available: {
    about: (title) => `${title} is ready to watch`,
    unnamed: "Something new is ready to watch",
  },
  media_upgraded: {
    about: (title) => `A better version of ${title} arrived`,
    unnamed: "A better version of a title arrived",
  },
  subtitles_ready: {
    about: (title) => `Subtitles for ${title} are ready`,
    unnamed: "Subtitles you asked for are ready",
  },
  files_quarantined: {
    about: (title) => `${title} was removed and can still be restored`,
    unnamed: "A title was removed and can still be restored",
  },
  files_purged: {
    about: (title) => `${title} was removed for good`,
    unnamed: "A title was removed for good",
  },
  acquisition_failed: {
    about: (title) => `Media could not get ${title}`,
    unnamed: "Media could not get a title you asked for",
  },
  system_intervention: {
    about: (title) => `${title} needs the owner`,
    unnamed: "A title needs the owner",
  },
  interest_check: {
    about: (title) => `Still watching ${title}?`,
    unnamed: "Still watching?",
  },
  retention_warning: {
    about: (title) => `${title} is leaving soon`,
    unnamed: "A title is leaving soon",
  },
  owner_health: {
    about: () => "Media paused its automation",
    unnamed: "Media paused its automation",
  },
  email_verification: {
    about: () => "Confirm your email address",
    unnamed: "Confirm your email address",
  },
} as const satisfies Record<
  NotificationKind,
  { about: (title: string) => string; unnamed: string }
>;

/** A season or an episode the catalog calls by its number: "Episode 10". */
const NUMBERED_PART = /^(?:season|episode) \d+$/iu;

/** What a sentence needs of the thing an event is about. */
type Subject = Pick<MediaReference, "title" | "rootTitle">;

/**
 * A season or an episode within a sentence: by its number when that is all
 * the catalog calls it ("episode 4"), otherwise by its own name in quotes.
 */
function partName(title: string, what: string): string {
  const name = title.trim();
  return NUMBERED_PART.test(name)
    ? name.toLowerCase()
    : `the ${what} “${name}”`;
}

/**
 * How a sentence names the thing an event is about. A film or a series goes
 * by its own name. A season or an episode is named together with its
 * series, because its own name ("Season 2", "Bears") says little alone.
 */
export const NOTIFICATION_SUBJECT = {
  movie: ({ title }) => title,
  series: ({ title }) => title,
  season: ({ title, rootTitle }) =>
    `${partName(title, "season")} of ${rootTitle}`,
  episode: ({ title, rootTitle }) =>
    `${partName(title, "episode")} of ${rootTitle}`,
} as const satisfies Record<MediaReference["kind"], (media: Subject) => string>;

/** The ways a notification reaches a person. */
export const NOTIFICATION_CHANNELS = [
  "in_app",
  "email",
  "discord",
  "discord_shared",
] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const CHANNEL_COPY = {
  in_app: "In Media",
  email: "Email",
  discord: "Discord",
  discord_shared: "Household Discord channel",
} as const satisfies Record<NotificationChannel, string>;

/** Where one delivery of a notification stands. */
export const DELIVERY_STATES = [
  "pending",
  "sending",
  "accepted",
  "failed",
  "unknown",
] as const;
export type DeliveryState = (typeof DELIVERY_STATES)[number];

/**
 * How a delivery ended up, in a word or two after its channel's name:
 * "Email: delivered".
 */
export const DELIVERY_OUTCOME_COPY = {
  unread: { label: "not read yet", tone: "warn" },
  read: { label: "read", tone: "ok" },
  waiting: { label: "waiting to send", tone: "neutral" },
  sending: { label: "sending", tone: "progress" },
  sent: { label: "sent", tone: "ok" },
  delivered: { label: "delivered", tone: "ok" },
  bounced: { label: "bounced", tone: "danger" },
  failed: { label: "not sent", tone: "danger" },
  unconfirmed: { label: "not confirmed", tone: "warn" },
} as const satisfies Record<string, Copy>;
export type DeliveryOutcome = keyof typeof DELIVERY_OUTCOME_COPY;
