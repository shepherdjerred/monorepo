import { expect, test } from "vitest";
import {
  activeThreadIn,
  preservePausedGoal,
  requireEmptyComposer,
} from "../bin/codex_theme_restart_status.ts";
import type { Runtime } from "../bin/codex_theme_restart_terminal.ts";

const composer =
  "\n› Ask Codex to do anything\n\n  model · /worktree    Vim: Insert";

test("observes a full session ID only in the active Codex footer", () => {
  const thread = "01a1429e-a0a6-7371-aef3-1a877d28b29b";
  const footer = composer.replace("model ·", `${thread} · model ·`);
  expect(activeThreadIn(footer)).toBe(thread);
  expect(activeThreadIn(`${thread} · model\n${composer}`)).toBeUndefined();
  expect(
    activeThreadIn(footer.replace(thread, thread.slice(0, 32))),
  ).toBeUndefined();
});

test("uses the last live composer rather than an empty prompt quoted earlier", () => {
  expect(() => requireEmptyComposer(composer)).not.toThrow();
  expect(() =>
    requireEmptyComposer(composer + "\n› private unsent draft"),
  ).toThrow("left untouched");
  expect(() => requireEmptyComposer("Approval required")).toThrow(
    "left untouched",
  );
  expect(() =>
    requireEmptyComposer(composer.replace("Vim: Insert", "Vim: Normal")),
  ).toThrow("left untouched");
});

const pausedDialog =
  "Resume paused goal?\n› 1. Resume goal\n  2. Leave paused  Keep it paused; use /goal resume later\nenter select · esc back\n";
const pausedComposer = composer + " | Goal paused (/goal resume)";

test("rejects dialogs overlaid on an apparently empty composer", () => {
  expect(() => requireEmptyComposer(pausedDialog + pausedComposer)).toThrow(
    "left untouched",
  );
});

function dialogFixture(initial: string, choice: string, completed: string) {
  let screen = initial;
  const keys: string[] = [];
  const runtime: Runtime = {
    now: Date.now,
    sleep: (milliseconds) => Bun.sleep(milliseconds),
    identity: async () => {
      return;
    },
    hc: async (args) => {
      if (args[0] === "read") return screen;
      keys.push(String(args[2]));
      if (args[2] === "down")
        screen = screen.replace("› 1.", "  1.").replace("  2.", "› 2.");
      if (args[2] === "enter") {
        expect(screen).toContain(`› 2. ${choice}`);
        screen = completed;
      }
      return "{}";
    },
  };
  return { runtime, keys, screen: () => screen };
}

test.each(["paused", "stalled"])(
  "keeps a %s goal inactive after restarting its client",
  async (state) => {
    const inactiveComposer = pausedComposer.replace(
      "Goal paused",
      `Goal ${state}`,
    );
    const fixture = dialogFixture(
      pausedDialog + inactiveComposer,
      "Leave paused",
      inactiveComposer,
    );
    await preservePausedGoal(fixture.runtime, "t5", () => Promise.resolve());
    expect(fixture.keys).toEqual(["down", "enter"]);
    expect(fixture.screen()).toBe(inactiveComposer);
  },
);
