import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { rwfRecordingSalt } from "#e2e/harness/rwf-settings.ts";
import { verifyNativeCombat } from "./native-combat.ts";

const match = "11111111-1111-4111-8111-111111111111";
const human = "22222222-2222-4222-8222-222222222222";
const bot = "33333333-3333-4333-8333-333333333333";
const other = "44444444-4444-4444-8444-444444444444";
const who = (uuid: string) =>
  `p${createHmac("sha256", rwfRecordingSalt).update(uuid).digest("hex").slice(0, 16)}`;
const lines = (cause = "Melee") => [
  `H\t4\t${match}\tapex-expanse\thash\t1\trwf-combat-1`,
  `R\t${who(human)}\tRED\ttrooper\tfalse`,
  `R\t${who(bot)}\tBLUE\ttrooper\ttrue`,
  `I\t5\t${who(bot)}\tattack\t${who(human)}`,
  `E\t6\tdied\t${who(human)}\t${who(bot)} ${cause}`,
];
const journal = () => ({
  schema: 1,
  kind: "rwf-capacity-combat",
  match,
  startedTick: 100,
  sampledTick: 110,
  human,
  bots: [bot],
  dropped: 0,
  pending: 0,
  hits: [
    {
      sequence: 0,
      serverTick: 105,
      attacker: bot,
      victim: human,
      cause: "ENTITY_ATTACK",
      cancelled: true,
      beforeHealth: 20,
      beforeAbsorption: 4,
      afterHealth: 16,
      afterAbsorption: 4,
    },
  ],
});
const expected = { match, total: 2 };

describe("ordinary native capacity combat evidence", () => {
  it("accepts actual custom HP loss even though the vanilla event was canceled", () => {
    expect(verifyNativeCombat(lines(), journal(), expected)).toMatchObject({
      attacked: true,
      killed: true,
      appliedHits: 1,
      killer: who(bot),
    });
  });

  it.each([
    "End of Game",
    "Poison",
    "Fall",
    "Void",
    "Drowned",
    "Bomb Exploded",
    "Unknown",
  ])("rejects bot credit on a %s death despite a prior actual hit", (cause) => {
    expect(() => verifyNativeCombat(lines(cause), journal(), expected)).toThrow(
      "direct combat death",
    );
  });

  it("rejects canceled/no-op or increased-health events and never invents an attack intent", () => {
    const capture = journal();
    const hit = capture.hits[0];
    if (hit === undefined) throw new Error("Missing fixture hit");
    hit.afterHealth = hit.beforeHealth;
    expect(() => verifyNativeCombat(lines(), capture, expected)).toThrow(
      "applied hit",
    );
    hit.afterHealth++;
    expect(() => verifyNativeCombat(lines(), capture, expected)).toThrow(
      "applied hit",
    );
    expect(() =>
      verifyNativeCombat(
        lines().filter((line) => !line.startsWith("I\t")),
        journal(),
        expected,
      ),
    ).toThrow("attack intent");
  });

  it("binds all three observations to the same actual roster bot and human", () => {
    const capture = journal();
    capture.bots.push(other);
    const hit = capture.hits[0];
    if (hit === undefined) throw new Error("Missing fixture hit");
    hit.attacker = other;
    const recording = [...lines(), `R\t${who(other)}\tBLUE\ttrooper\ttrue`];
    expect(() =>
      verifyNativeCombat(recording, capture, { match, total: 3 }),
    ).toThrow("same bot");
    hit.victim = other;
    expect(() =>
      verifyNativeCombat(recording, capture, { match, total: 3 }),
    ).toThrow("foreign");
    expect(() =>
      verifyNativeCombat(lines(), journal(), { match: other, total: 2 }),
    ).toThrow("different match");
    expect(() =>
      verifyNativeCombat(
        lines().map((line) => line.replace(match, other)),
        journal(),
        expected,
      ),
    ).toThrow("another match");
  });

  it("rejects incomplete journals, changed clocks and unknown fields", () => {
    for (const patch of [{ dropped: 1 }, { pending: 1 }, { sampledTick: 99 }])
      expect(() =>
        verifyNativeCombat(lines(), { ...journal(), ...patch }, expected),
      ).toThrow();
    const capture = journal();
    const hit = capture.hits[0];
    if (hit === undefined) throw new Error("Missing fixture hit");
    hit.serverTick = 111;
    expect(() => verifyNativeCombat(lines(), capture, expected)).toThrow(
      "reordered",
    );
    expect(() =>
      verifyNativeCombat(
        lines(),
        { ...journal(), injectedDamage: true },
        expected,
      ),
    ).toThrow();
  });

  it("accepts projectile damage only with the matching original projectile death", () => {
    const capture = journal();
    const hit = capture.hits[0];
    if (hit === undefined) throw new Error("Missing fixture hit");
    hit.cause = "PROJECTILE";
    expect(
      verifyNativeCombat(lines("Projectile"), capture, expected).appliedHits,
    ).toBe(1);
    expect(() => verifyNativeCombat(lines(), capture, expected)).toThrow(
      "direct combat death",
    );
  });
});
