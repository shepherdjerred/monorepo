export class PlaybackCommandBoundaryError extends Error {}

/** A denied source that already emitted the public moderation notice. */
export class PlaybackCommandBlockedError extends PlaybackCommandBoundaryError {}
