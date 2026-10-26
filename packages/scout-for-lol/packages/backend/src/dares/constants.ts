/** Human confirmations are actor-bound and expire after ten minutes. */
export const DARE_INTENT_TTL_MS = 10 * 60 * 1000;
export const DARE_ACCEPT_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Allow ingestion to catch games ending before the contractual deadline. */
export const DARE_WINDOW_INGESTION_GRACE_MS = 30 * 60 * 1000;
export const DARE_MAX_TEXT_LENGTH = 400;
