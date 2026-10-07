import { describe, expect, it } from "vitest";
import { spectatorImmunity } from "./watcher-gate.ts";
import { watcherFixture as fixture } from "#learning/native/evidence/test-support/watcher-fixture.ts";

const attacker = "22222222-2222-4222-8222-222222222222";
const watcher = "55555555-5555-4555-8555-555555555555";

describe("original native spectator immunity", () => {
  it("requires unchanged spectator health and actual positive-control fighter damage despite identical console errors", () => {
    const result = spectatorImmunity(fixture()).spectator;
    expect(result.watcher).toBe(watcher);
    expect(result.damageChallenges).toBe(3);
    expect(result.watcherHealth).toBe(20);
    expect(result.nativeFighterDamage).toBeCloseTo(2.9, 6);
    expect(result.selectedAsTarget).toBe(false);
    expect(result.remainedSpectatorThroughEnd).toBe(true);
  });

  it.each([
    "health",
    "end-health",
    "mode",
    "end-mode",
    "body-count",
    "command",
    "identity",
    "contact",
    "fighter-health",
    "damage-window",
    "phase",
    "counter",
    "loss",
  ])("rejects changed native %s proof", (edit) => {
    const value = fixture();
    if (edit === "health")
      value.get("watcher-health-after").response =
        "RwfSpectator has the following entity data: 17.1f";
    if (edit === "end-health")
      value.get("end-watcher-health").response =
        "RwfSpectator has the following entity data: 17.1f";
    if (edit === "mode") value.get("spectator-mode").response = "Test failed";
    if (edit === "end-mode")
      value.get("end-spectator-mode").response = "Test failed";
    if (edit === "body-count")
      value.get("watcher-present").response = "Test passed. Count: 2";
    if (edit === "command")
      value.get("watcher-damage-1").command =
        `damage RwfSpectator 4 minecraft:generic by ${attacker}`;
    if (edit === "identity")
      value.get("watcher-health-before").response =
        "OtherWatcher has the following entity data: 20.0f";
    if (edit === "contact")
      value.get("watcher-position").response =
        "RwfSpectator has the following entity data: [22.0d, 65.0d, 3.0d]";
    if (edit === "fighter-health")
      value.get("fighter-health-after").response =
        "Beta has the following entity data: 20.0f";
    if (edit === "damage-window") value.get("fighter-damage").endSequence = 2;
    if (edit === "phase") value.get("fighter-damage").startPhase = "LOBBY";
    if (edit === "counter") value.get("fighter-damage").sequence++;
    if (edit === "loss") value.native.splice(9, 1);
    expect(() => spectatorImmunity(value)).toThrow();
  });

  it.each([
    "target",
    "watcher-role",
    "damage-victim",
    "damage-attacker",
    "no-damage",
    "input",
    "roster",
    "stopped",
  ])("rejects changed original %s evidence", (edit) => {
    const value = fixture();
    if (edit === "target") value.applied.targetBody = watcher;
    if (edit === "watcher-role") value.identity.watcher = attacker;
    if (edit === "damage-victim") value.damage.victim = watcher;
    if (edit === "damage-attacker") value.damage.attacker = watcher;
    if (edit === "no-damage") value.damage.after = 20;
    if (edit === "input") value.recording += "\nN\t0\twatcher";
    if (edit === "roster")
      value.recording = value.recording.replace("true", "false");
    if (edit === "stopped")
      value.recording = value.recording.replace(
        "LAST_TEAM_STANDING",
        "STOPPED",
      );
    expect(() => spectatorImmunity(value)).toThrow();
  });
});
