/** A Discord-side voice connection death, timestamped for freshness-based classification. */
export type VoiceCloseInfo = {
  code: number;
  /** True for Discord's 4014 "disconnected" — a deliberate removal (e.g. moderator disconnect). */
  deliberate: boolean;
  atMs: number;
};

/** Incident-scoped view of close state. Release it when delayed recovery no longer needs it. */
export type VoiceCloseSource = {
  lastVoiceCloseInfo: () => VoiceCloseInfo | null;
  release: () => void;
};

export type VoiceCloseTracker = VoiceCloseSource & {
  record: (info: VoiceCloseInfo) => boolean;
  retain: () => VoiceCloseSource;
};

export const EMPTY_VOICE_CLOSE_SOURCE: VoiceCloseSource = {
  lastVoiceCloseInfo: () => null,
  release: () => null,
};

/**
 * Ref-counted close state for one voice connection. A recovery lease keeps that connection's
 * observer alive after its pooled userbot is released and reused by another session.
 */
export function createVoiceCloseTracker(detach: () => void): VoiceCloseTracker {
  let closeInfo: VoiceCloseInfo | null = null;
  let references = 1;
  let ownerReleased = false;

  const releaseReference = (): void => {
    references -= 1;
    if (references === 0) {
      detach();
    }
  };
  const lastVoiceCloseInfo = (): VoiceCloseInfo | null => closeInfo;

  return {
    lastVoiceCloseInfo,
    record: (info) => {
      if (closeInfo?.deliberate === true && !info.deliberate) {
        return false;
      }
      closeInfo = info;
      return true;
    },
    retain: () => {
      references += 1;
      let released = false;
      return {
        lastVoiceCloseInfo,
        release: () => {
          if (!released) {
            released = true;
            releaseReference();
          }
        },
      };
    },
    release: () => {
      if (!ownerReleased) {
        ownerReleased = true;
        releaseReference();
      }
    },
  };
}
