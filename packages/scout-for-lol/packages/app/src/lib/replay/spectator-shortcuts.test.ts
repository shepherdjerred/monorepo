import { expect, test, vi } from "vitest";
import type { ReplaySession, ReplaySessionState } from "@scout-for-lol/replay";
import { createSpectatorShortcuts } from "./spectator-shortcuts.ts";

function fixture() {
  const state: ReplaySessionState = {
    timeSeconds: 0,
    durationSeconds: 60,
    playing: false,
    rate: 1,
    perspective: "all",
    camera: { mode: "free" },
    participants: [
      { participantId: 42, name: "Blue", championName: "Gwen", teamId: 100 },
      { participantId: 0, name: "Red", championName: "Ahri", teamId: 200 },
    ],
  };
  const session: ReplaySession = {
    play: vi.fn(),
    pause: vi.fn(),
    seek: vi.fn(() => Promise.resolve()),
    setRate: vi.fn(),
    focusParticipant: vi.fn(),
    setCamera: vi.fn(),
    setPerspective: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
    getState: () => state,
    subscribe: vi.fn(() => vi.fn()),
    subscribeErrors: vi.fn(() => vi.fn()),
  };
  const current = vi.fn((): ReplaySession | null => session);
  const command = vi.fn(
    async (action: (active: ReplaySession) => void | Promise<void>) => {
      await action(session);
    },
  );
  return {
    session,
    state,
    current,
    command,
    controls: createSpectatorShortcuts({ current, command }),
  };
}

const key = (value: string, changes: Partial<KeyboardEvent> = {}) => ({
  key: value,
  repeat: false,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  shiftKey: false,
  defaultPrevented: false,
  ...changes,
});

test("focuses once then locks the same displayed champion without guessing IDs", () => {
  const { controls, session } = fixture();
  expect(controls.handle(key("1"))).toBe(true);
  expect(session.focusParticipant).toHaveBeenCalledWith(42);
  expect(session.setCamera).not.toHaveBeenCalled();
  controls.handle(key("1"));
  expect(session.setCamera).toHaveBeenCalledWith({
    mode: "follow",
    participantId: 42,
  });
  controls.handle(key("q"));
  expect(session.focusParticipant).toHaveBeenLastCalledWith(0);
  controls.handle(key("q"));
  expect(session.setCamera).toHaveBeenLastCalledWith({
    mode: "follow",
    participantId: 0,
  });
});

test("pointer interaction clears repeated-selection intent and preserves other keys", () => {
  const { controls, session, command } = fixture();
  controls.handle(key("1"));
  controls.clearFocus();
  controls.handle(key("1"));
  expect(session.focusParticipant).toHaveBeenCalledTimes(2);
  for (const event of [
    key("2"),
    key("z"),
    key("1", { repeat: true }),
    key("q", { ctrlKey: true }),
    key("q", { altKey: true }),
    key("q", { metaKey: true }),
    key("q", { shiftKey: true }),
    key("1", { defaultPrevented: true }),
  ])
    expect(controls.handle(event)).toBe(false);
  expect(command).toHaveBeenCalledTimes(2);
});

test("a deferred shortcut cannot target a replaced replay session", async () => {
  const { current, session } = fixture();
  let pending: ((active: ReplaySession) => void | Promise<void>) | undefined;
  const controls = createSpectatorShortcuts({
    current,
    command: async (action) => {
      pending = action;
    },
  });
  controls.handle(key("1"));
  current.mockReturnValue(null);
  await pending?.(session);
  expect(session.focusParticipant).not.toHaveBeenCalled();
  expect(controls.handle(key("1"))).toBe(false);
});
