import { describe, expect, it } from "vitest";
import { healingLifecycle, healingRoster } from "./healing-gate.ts";
import { healingFixture as fixture } from "#learning/native/evidence/test-support/healing-fixture.ts";

const match = "11111111-1111-4111-8111-111111111111";
const body = "22222222-2222-4222-8222-222222222222";

function mutateHealth(value: ReturnType<typeof fixture>, edit: string) {
  if (edit === "inventory") value.get("apples-after").response = "Test failed";
  if (edit === "recovery")
    value.get("health-after").response =
      "Healer has the following entity data: 8.0f";
  if (edit === "absorption")
    value.get("absorption-after").response =
      "Healer has the following entity data: 0.0f";
  if (edit === "name")
    value.get("health-after").response =
      "Other has the following entity data: 9.0f";
  if (edit === "damage")
    value.get("hurt").response =
      "Target is invulnerable to the given damage type";
  if (edit === "live-body")
    value.get(`live-body-${body}`).response = "Test failed";
  if (edit === "retired-body")
    value.get(`ended-body-${body}`).response = "Test passed. Count: 1";
}

function mutateFinish(value: ReturnType<typeof fixture>, edit: string) {
  if (edit === "no-finish") {
    const row = value.commands.find((entry) => entry.command === "finish");
    if (row === undefined) throw new Error("Synthetic finish missing");
    row.command = "sample";
  }
  if (edit === "second-finish") {
    const row = value.commands.find((entry) => entry.command === "release");
    if (row === undefined) throw new Error("Synthetic release missing");
    row.command = "finish";
  }
}

describe("original native healing and lifecycle", () => {
  it("requires consumption, actual recovery, the authored eating interval and all body cleanup", () => {
    expect(healingLifecycle(fixture()).healing).toEqual({
      healer: body,
      before: 20,
      hurt: 8,
      after: 9,
      absorption: 4,
      life: 0,
      eatingTicks: 32,
      applesBefore: 3,
      applesAfter: 2,
      botsDespawned: 16,
      savedNpcs: 0,
    });
  });

  it.each(["never_eats", "gapple_hoarder"])(
    "respects original %s without changing the draft",
    (quirk) => {
      const value = fixture();
      const first = value.identity.personalities[0];
      if (first === undefined)
        throw new Error("Synthetic first personality missing");
      first.quirks.push(quirk);
      expect(
        healingRoster(value.fighters, value.identity.personalities).healer.body,
      ).toBe(value.fighters[1]?.body);
      expect(() => healingLifecycle(value)).toThrow();
    },
  );

  it("requires the Stop to be drained by the original finish command", () => {
    const value = fixture();
    const finish = value.commands.find((row) => row.command === "finish");
    const later = value.commands.find(
      (row) => row.state.phase === "LOBBY" && row.state.result === "stopped",
    );
    if (finish === undefined || later === undefined)
      throw new Error("Synthetic finish boundary missing");
    finish.command = "sample";
    later.command = "finish";
    expect(() => healingLifecycle(value)).toThrow();
  });

  it("requires every personality before selecting a healer", () => {
    const value = fixture();
    const last = value.identity.personalities.at(-1);
    if (last === undefined)
      throw new Error("Synthetic last personality missing");
    last.id = "foreign-personality";
    expect(() => healingLifecycle(value)).toThrow();
  });

  it.each([
    "inventory",
    "recovery",
    "absorption",
    "name",
    "damage",
    "live-body",
    "retired-body",
    "registry",
    "save",
    "phase",
    "command",
    "lost-command",
    "saved-npc",
    "missing-save",
    "recording",
    "human-input",
  ])("rejects changed original %s evidence", (edit) => {
    const value = fixture();
    mutateHealth(value, edit);
    if (edit === "registry") value.get("registry-live").response += "\nHealer";
    if (edit === "save")
      value.get("save-ended").response = "Saving Citizens...";
    if (edit === "phase") value.get("health-after").startPhase = "LOBBY";
    if (edit === "command")
      value.get("hurt").command = `damage ${body} 12 minecraft:generic`;
    if (edit === "lost-command") value.native.splice(22, 1);
    if (edit === "saved-npc") value.npcSave = "npc:\n  1:\n    name: Healer";
    if (edit === "missing-save") value.npcSave = "";
    if (edit === "recording")
      value.recording = value.recording.replace("STOPPED", "DRAW");
    if (edit === "human-input") value.recording += "\nN\t0\tplayer";
    expect(() => healingLifecycle(value)).toThrow();
  });

  it.each([
    "start",
    "release",
    "use",
    "override",
    "life",
    "body",
    "native-window",
    "short-interval",
    "no-finish",
    "second-finish",
  ])("rejects changed original item or stop %s evidence", (edit) => {
    const value = fixture();
    mutateFinish(value, edit);
    const start = value.eating[0];
    const using = value.eating[1];
    const released = value.eating[32];
    if (start === undefined || using === undefined || released === undefined)
      throw new Error("Synthetic item controls missing");
    if (edit === "start") start.authored = start.commands = ["Stop[]"];
    if (edit === "release") released.authored = released.commands = ["Stop[]"];
    if (edit === "use") for (const row of value.eating) row.usingItem = false;
    if (edit === "override") using.commands = ["Jump[]"];
    if (edit === "life") released.life++;
    if (edit === "body") released.body = match;
    if (edit === "native-window") value.get("apples-after").startSequence = 3;
    if (edit === "short-interval") {
      released.botTick--;
      released.serverTick--;
    }
    expect(() => healingLifecycle(value)).toThrow();
  });
});
