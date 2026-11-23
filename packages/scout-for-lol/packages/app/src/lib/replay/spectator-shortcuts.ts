import type { ReplaySession } from "@scout-for-lol/replay";

type KeyInput = Pick<
  KeyboardEvent,
  | "key"
  | "repeat"
  | "ctrlKey"
  | "altKey"
  | "metaKey"
  | "shiftKey"
  | "defaultPrevented"
>;
type ReplayCommand = (active: ReplaySession) => void | Promise<void>;

// Riot's replay controls select a champion once and lock on repeated selection:
// https://support.riotgames.com/en-us/league-of-legends/gameplay/replays-faq-pro-tips/
// Keys address the engine's displayed team roster, never a guessed network ID.
export function createSpectatorShortcuts(options: {
  current: () => ReplaySession | null;
  command: (action: ReplayCommand) => Promise<void>;
}) {
  let focusedParticipant: number | null = null;
  return {
    clearFocus() {
      focusedParticipant = null;
    },
    handle(event: KeyInput): boolean {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        event.shiftKey
      )
        return false;
      const key = event.key.toLowerCase();
      const blue = "12345".indexOf(key),
        red = "qwert".indexOf(key);
      if (key.length !== 1 || (blue === -1 && red === -1)) return false;
      const active = options.current();
      if (active === null) return false;
      const state = active.getState();
      const participant = state.participants.filter(
        (player) => player.teamId === (blue === -1 ? 200 : 100),
      )[blue === -1 ? red : blue];
      if (participant === undefined) return false;
      const id = participant.participantId;
      const alreadyFollowing =
        state.camera.mode === "follow" && state.camera.participantId === id;
      const lock = alreadyFollowing || focusedParticipant === id;
      focusedParticipant = id;
      void options.command((session) => {
        if (session !== active || options.current() !== active) return;
        if (lock) session.setCamera({ mode: "follow", participantId: id });
        else session.focusParticipant(id);
      });
      return true;
    },
  };
}

/** Own only viewer shortcuts; text entry, native controls and other routes keep their keys. */
export function attachSpectatorShortcuts(options: {
  canvas: HTMLCanvasElement;
  surface: HTMLElement;
  current: () => ReplaySession | null;
  command: (action: ReplayCommand) => Promise<void>;
  signal: AbortSignal;
}): void {
  const controller = createSpectatorShortcuts(options);
  const document = options.canvas.ownerDocument;
  options.surface.addEventListener(
    "pointerdown",
    () => {
      controller.clearFocus();
    },
    { signal: options.signal },
  );
  document.addEventListener(
    "keydown",
    (event) => {
      const target = event.target;
      if (
        !options.canvas.isConnected ||
        options.surface.getClientRects().length === 0 ||
        !(target instanceof Element) ||
        !options.surface.contains(target) ||
        target.closest(
          "input, textarea, select, button, a, [contenteditable]:not([contenteditable=false]), [role=dialog]",
        ) !== null
      )
        return;
      if (controller.handle(event)) event.preventDefault();
    },
    { signal: options.signal },
  );
}
