import { describe, expect, it } from "bun:test";
import { AloneInVoiceWatcher } from "@shepherdjerred/discord-stream-lifecycle/session/auto-leave";

function makeSession(guildId: string, voiceChannelId: string) {
  return { guildId, voiceChannelId, startedAt: new Date() };
}

describe("AloneInVoiceWatcher", () => {
  it("does not fire when humans are present", async () => {
    const watcher = new AloneInVoiceWatcher({ aloneGraceMs: 20 });
    let fired = false;
    watcher.evaluate(
      makeSession("g1", "c1"),
      { guildId: "g1", voiceChannelId: "c1", humanMemberCount: 2 },
      () => {
        fired = true;
      },
    );
    expect(watcher.isArmed()).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(fired).toBe(false);
  });

  it("fires after the grace period when channel goes empty", async () => {
    const watcher = new AloneInVoiceWatcher({ aloneGraceMs: 20 });
    let fired = false;
    watcher.evaluate(
      makeSession("g1", "c1"),
      { guildId: "g1", voiceChannelId: "c1", humanMemberCount: 0 },
      () => {
        fired = true;
      },
    );
    expect(watcher.isArmed()).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(fired).toBe(true);
    expect(watcher.isArmed()).toBe(false);
  });

  it("cancels the timer when a human rejoins", async () => {
    const watcher = new AloneInVoiceWatcher({ aloneGraceMs: 40 });
    let fired = false;
    const session = makeSession("g1", "c1");
    watcher.evaluate(
      session,
      { guildId: "g1", voiceChannelId: "c1", humanMemberCount: 0 },
      () => {
        fired = true;
      },
    );
    expect(watcher.isArmed()).toBe(true);
    watcher.evaluate(
      session,
      { guildId: "g1", voiceChannelId: "c1", humanMemberCount: 1 },
      () => {
        fired = true;
      },
    );
    expect(watcher.isArmed()).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(fired).toBe(false);
  });

  it("ignores snapshots for a different guild or channel", () => {
    const watcher = new AloneInVoiceWatcher({ aloneGraceMs: 100 });
    let fired = false;
    watcher.evaluate(
      makeSession("g1", "c1"),
      { guildId: "g2", voiceChannelId: "c1", humanMemberCount: 0 },
      () => {
        fired = true;
      },
    );
    watcher.evaluate(
      makeSession("g1", "c1"),
      { guildId: "g1", voiceChannelId: "c-other", humanMemberCount: 0 },
      () => {
        fired = true;
      },
    );
    expect(watcher.isArmed()).toBe(false);
    expect(fired).toBe(false);
  });

  it("manual cancel() stops the timer", async () => {
    const watcher = new AloneInVoiceWatcher({ aloneGraceMs: 20 });
    let fired = false;
    watcher.evaluate(
      makeSession("g1", "c1"),
      { guildId: "g1", voiceChannelId: "c1", humanMemberCount: 0 },
      () => {
        fired = true;
      },
    );
    watcher.cancel();
    expect(watcher.isArmed()).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(fired).toBe(false);
  });
});
