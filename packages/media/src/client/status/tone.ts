/**
 * The five badge tones. Each is a text and fill pair in `styles/tokens.css`.
 */
export type StatusTone = "ok" | "progress" | "warn" | "danger" | "neutral";

/**
 * The tone of every status value the client shows as a badge.
 *
 * `Status` accepts only the keys of this table, so a contract enum that
 * gains a value stops compiling at the badge that renders it until the value
 * is given a tone here. One word has one tone wherever it appears.
 */
export const STATUS_TONES = {
  // Availability, and a request its owner withdrew.
  wanted: "neutral",
  searching: "progress",
  downloading: "progress",
  validating: "progress",
  importing: "progress",
  available: "ok",
  quarantined: "warn",
  removed: "danger",
  cancelled: "neutral",

  // Operations.
  queued: "neutral",
  running: "progress",
  completed: "ok",
  failed: "danger",
  reconciling: "warn",

  // A person's interest in a title.
  following: "ok",
  finished: "neutral",
  dropped: "neutral",
  expired: "neutral",

  // Removal history, files, and captions.
  purged: "danger",
  restored: "ok",
  installed: "ok",

  // Whether a household member may request.
  requests_enabled: "ok",
  requests_paused: "warn",

  // Values the API sends in fields its contract types as plain strings:
  // retention decisions, published files, subtitles, notification
  // deliveries, and history reviews. `WireStatus` reads these.
  eligible: "warn",
  grace_period: "warn",
  warning_pending: "warn",
  notice_pending: "warn",
  reply_pending: "warn",
  published: "ok",
  validated: "ok",
  superseded: "neutral",
  cleaned: "neutral",
  rejected: "danger",
  pending: "neutral",
  sending: "progress",
  sent: "ok",
  accepted: "ok",
  delivered: "ok",
  viewed: "ok",
  bounced: "danger",
  awaiting_responses: "warn",
  applied: "ok",
  released: "neutral",
  unknown: "neutral",
} as const satisfies Record<string, StatusTone>;

/** A status value with a tone. */
export type KnownStatus = keyof typeof STATUS_TONES;

const TONE_BY_WORD: ReadonlyMap<string, StatusTone> = new Map(
  Object.entries(STATUS_TONES),
);

/**
 * The tone of a status the API contract types as a plain string.
 *
 * Those fields are open on the wire and one of them carries the mail
 * provider's own status, so a word outside the table is expected input, not
 * a broken contract, and reads as neutral.
 */
export function wireStatusTone(value: string): StatusTone {
  return TONE_BY_WORD.get(value) ?? "neutral";
}
