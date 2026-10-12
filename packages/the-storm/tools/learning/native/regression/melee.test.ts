import { describe, expect, it } from "vitest";
import { meleeFixture } from "./melee-fixture.ts";
import { nativeMelee } from "./melee-gate.ts";

describe("original native LOS and knockback", () => {
  it("requires refused wall damage, a clear native hit and separate applied Java knockback", () => {
    const value = nativeMelee(meleeFixture()).melee;
    expect(value.blockedRefusal).toBe("NO_LINE_OF_SIGHT");
    expect(value.blockedDamage).toBe(0);
    expect(value.clearDamage).toBeCloseTo(2.9, 6);
    expect(value.clearVelocity).toEqual([0.4, 0.4, 0]);
    expect(value.confirmedJavaHits).toBe(1);
    expect(value.actualJavaDamage).toBeCloseTo(2.9, 6);
    expect(value.restoredWallCells).toBe(2);
  });

  it.each([
    "visible",
    "reach",
    "refusal",
    "damage",
    "velocity",
    "wall",
    "restore",
    "identity",
    "immunity",
    "pose",
  ])("rejects changed original blocked %s proof", (edit) => {
    const value = meleeFixture();
    value.editProbe("blocked", (probe) => {
      if (edit === "visible") probe.visible = true;
      if (edit === "reach") probe.reachable = false;
      if (edit === "refusal") probe.refusal = "OUT_OF_REACH";
      if (edit === "damage") probe.victimAfter.health = 17.1;
      if (edit === "velocity") probe.victimAfter.velocityX = 0.4;
      if (edit === "wall")
        probe.wallDuring = ["minecraft:air", "minecraft:air"];
      if (edit === "restore")
        probe.wallAfter = ["minecraft:stone", "minecraft:stone"];
      if (edit === "identity") probe.victimAfter.body = value.identity.attacker;
      if (edit === "immunity") probe.victimBefore.invulnerable = true;
      if (edit === "pose") probe.victimBefore.x += 5;
    });
    expect(() => nativeMelee(value)).toThrow();
  });

  it.each([
    "damage",
    "horizontal",
    "vertical",
    "refusal",
    "equipment",
    "mode",
    "clock",
    "continuity",
    "phase",
  ])("rejects changed original clear %s proof", (edit) => {
    const value = meleeFixture();
    value.editProbe("clear", (probe) => {
      if (edit === "damage") probe.victimAfter.health = 20;
      if (edit === "horizontal") probe.victimAfter.velocityX = -0.4;
      if (edit === "vertical") probe.victimAfter.velocityY = 0;
      if (edit === "refusal") probe.refusal = "HIT_WINDOW";
      if (edit === "equipment") probe.attackerBefore.weapon = "GOLDEN_APPLE";
      if (edit === "mode") probe.victimBefore.gameMode = "SPECTATOR";
      if (edit === "clock") probe.serverTick++;
      if (edit === "continuity") probe.victimBefore.health = 19;
      if (edit === "phase") probe.trial = "blocked";
    });
    expect(() => nativeMelee(value)).toThrow();
  });

  it.each([
    "target",
    "velocity",
    "native-window",
    "raw-hit",
    "hit-clock",
    "body",
    "command",
    "ordinal",
    "loss",
    "input",
    "ending",
  ])("rejects changed Java or retained %s evidence", (edit) => {
    const value = meleeFixture();
    if (edit === "target") value.applied.targetBody = value.identity.attacker;
    if (edit === "velocity") value.hit.velocityX = value.hit.velocityY = 0;
    if (edit === "native-window") value.get("clear").endSequence = 9;
    if (edit === "raw-hit") value.direct.after = 20;
    if (edit === "hit-clock") value.hit.serverTick--;
    if (edit === "body") value.identity.victim = value.identity.attacker;
    if (edit === "command")
      value.get("blocked").command = value.get("clear").command;
    if (edit === "ordinal") value.get("clear").sequence++;
    if (edit === "loss") value.native.splice(2, 1);
    if (edit === "input") value.recording += "\nN\t0\tplayer";
    if (edit === "ending")
      value.recording = value.recording.replace(
        "LAST_TEAM_STANDING",
        "STOPPED",
      );
    expect(() => nativeMelee(value)).toThrow();
  });
});
