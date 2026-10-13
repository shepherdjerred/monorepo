import { useEffect, useRef, useState } from "react";
import { FeedAudioPlayer, type FeedAudioFormat } from "./feed-audio.ts";

export type FeedSound = {
  readonly muted: boolean;
  /**
   * True until the browser lets the page make sound. Autoplay policy keeps
   * audio suspended until the first click or key press anywhere on the page.
   */
  readonly blocked: boolean;
  readonly toggleMuted: () => void;
  /** Pass as `useDriverFeed`'s `onAudio`. */
  readonly play: (pcm: DataView, format: FeedAudioFormat) => void;
};

function loadMuted(storageKey: string): boolean {
  try {
    return globalThis.localStorage.getItem(storageKey) === "true";
  } catch {
    return false;
  }
}

function storeMuted(storageKey: string, muted: boolean): void {
  try {
    globalThis.localStorage.setItem(storageKey, String(muted));
  } catch {
    // A blocked store only means the choice is not remembered next visit.
  }
}

/**
 * Play the feed's sound through Web Audio, with a mute choice remembered in
 * localStorage under `storageKey`.
 */
export function useFeedSound(storageKey: string): FeedSound {
  const [muted, setMuted] = useState(() => loadMuted(storageKey));
  const [blocked, setBlocked] = useState(false);
  const playerRef = useRef<FeedAudioPlayer>(undefined);
  // Read once at mount; later toggles go straight to the live player.
  const initialMutedRef = useRef(muted);

  useEffect(() => {
    const player = new FeedAudioPlayer(initialMutedRef.current);
    playerRef.current = player;
    setBlocked(!player.running);
    // The first click or key press on the page (claiming a seat, playing)
    // starts the audio context.
    const resume = async () => {
      await player.unlock();
      setBlocked(!player.running);
      if (player.running) removeListeners();
    };
    const unlock = () => {
      void resume();
    };
    const removeListeners = () => {
      document.removeEventListener("pointerdown", unlock);
      document.removeEventListener("keydown", unlock);
    };
    document.addEventListener("pointerdown", unlock);
    document.addEventListener("keydown", unlock);
    return () => {
      removeListeners();
      playerRef.current = undefined;
      player.close();
    };
  }, []);

  return {
    muted,
    blocked,
    toggleMuted: () => {
      const next = !muted;
      setMuted(next);
      playerRef.current?.setMuted(next);
      storeMuted(storageKey, next);
    },
    play: (pcm, format) => {
      playerRef.current?.play(pcm, format);
    },
  };
}
