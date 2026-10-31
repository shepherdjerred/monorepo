import { expect, test } from "vitest";
import {
  backgroundRunningTask,
  nativeConversation,
  preservePausedGoal,
  requireEmptyComposer,
  statusCommandStaged,
} from "../bin/codex_theme_restart_status.ts";
import type { Runtime } from "../bin/codex_theme_restart_terminal.ts";

const thread = "01a1429e-a0a6-7371-aef3-1a877d28b29b";
const composer =
  "\n› Ask Codex to do anything\n\n  model · /worktree    Vim: Insert";
const card = `/status\n\n  >_ OpenAI Codex (v0.162.1)\n\n  Session:             ${thread}\n`;

test("accepts a full UUID only in a complete native status card", () => {
  expect(nativeConversation(card + composer)).toBe(thread);
  expect(nativeConversation(card + card + composer)).toBe(thread);
  expect(nativeConversation(`Session: ${thread}` + composer)).toBeUndefined();
  expect(
    nativeConversation(card.replace(thread, "not-a-uuid") + composer),
  ).toBeUndefined();
  expect(
    nativeConversation(card + `Session: ${thread}\n` + composer),
  ).toBeUndefined();
});

test("status-like model output without the native header is not an identity", () => {
  expect(
    nativeConversation(`/status\nSession: ${thread}\n` + composer),
  ).toBeUndefined();
});

test("recognizes only the exact staged native command in the live composer", () => {
  expect(statusCommandStaged(card + "\n› /status\n  Vim: Insert")).toBe(true);
  expect(statusCommandStaged(card + composer)).toBe(false);
  expect(statusCommandStaged("\n› /status user draft\n  Vim: Insert")).toBe(
    false,
  );
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
    conversationSaved: () => true,
    appearanceConfigured: () => true,
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

test("exits an active client through Run in background without cancelling its task", async () => {
  const fixture = dialogFixture(
    "Task is still running\n› 1. Cancel task\n  2. Run in background  Exit Codex and leave the task running\n  3. Exit  Stop the current task and exit Codex\nenter select · esc back",
    "Run in background",
    "shell",
  );
  await backgroundRunningTask(fixture.runtime, "t5");
  expect(fixture.keys).toEqual(["down", "enter"]);
  expect(fixture.screen()).toBe("shell");
});

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
    await preservePausedGoal(fixture.runtime, "t5");
    expect(fixture.keys).toEqual(["down", "enter"]);
    expect(fixture.screen()).toBe(inactiveComposer);
  },
);
