/**
 * Fan-out of "something about a room changed" notifications to in-process listeners.
 *
 * A change names where it happened, never what changed: a listener re-reads the authoritative
 * state (actors, station, voice cache) itself, so there is no replay log and no payload to drift.
 * Playback changes (`userId: null`) come from the actor subscription each session already owns,
 * from session creation and teardown, and from station start and stop. Voice changes name the user
 * whose own voice state moved.
 */
export type RoomChange = {
  readonly guildId: string;
  /** The voice channel a playback change happened in; null for a voice-state change. */
  readonly channelId: string | null;
  /** The member whose voice state changed; null for a playback change. */
  readonly userId: string | null;
};

export type RoomChangeListener = (change: RoomChange) => void;

export class RoomChangeHub {
  private readonly listeners = new Set<RoomChangeListener>();

  /** Returns the unsubscribe function; calling it twice is harmless. */
  subscribe(listener: RoomChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  notify(change: RoomChange): void {
    for (const listener of this.listeners) listener(change);
  }

  /** Live listener count, for leak checks. */
  get size(): number {
    return this.listeners.size;
  }
}
