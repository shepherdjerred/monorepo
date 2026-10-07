import { z } from "zod";
import { type NativeCommand, nativeCommands } from "./console.ts";
import {
  RegressionCommand,
  regressionJournal,
} from "#learning/native/regression-gate.ts";

export const HealingPersonality = z.strictObject({
  id: z.string().regex(/^[a-z0-9_-]+$/u),
  name: z.string().regex(/^\w+$/u),
  quirks: z.array(z.string().min(1)),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
});
export const HealingIdentity = z.strictObject({
  schema: z.literal(1),
  source: z.literal("automated-regression-console"),
  humanDemonstration: z.literal(false),
  match: z.uuid(),
  healer: z.uuid(),
  personalities: z.array(HealingPersonality).length(16),
});
export type HealingIdentity = z.infer<typeof HealingIdentity>;
type Journal = ReturnType<typeof regressionJournal>;
type Fighter = Journal["transitions"][number]["fighters"][number];

/** Select once from the original draft, respecting its authored eating habits. */
export function healingRoster(
  fighters: Fighter[],
  personalities: z.infer<typeof HealingPersonality>[],
) {
  const catalog = new Map(personalities.map((row) => [row.id, row]));
  if (
    fighters.length !== 16 ||
    fighters.some((row) => !row.bot || !row.alive) ||
    catalog.size !== 16 ||
    new Set(fighters.map((row) => row.personality)).size !== 16
  )
    throw new Error(
      "Healing needs the original sixteen living bot personalities",
    );
  for (const row of fighters)
    if (!catalog.has(row.personality))
      throw new Error(
        "Original healing personality missing from frozen content",
      );
  const healer = fighters.find((row) => {
    const personality = catalog.get(row.personality);
    if (personality === undefined)
      throw new Error(
        "Original healing personality missing from frozen content",
      );
    return (
      row.kit === "trooper" &&
      !personality.quirks.some((quirk) =>
        ["never_eats", "gapple_hoarder"].includes(quirk),
      )
    );
  });
  const personality =
    healer === undefined ? undefined : catalog.get(healer.personality);
  if (healer === undefined || personality === undefined)
    throw new Error("Original draft has no eligible healing Trooper");
  return {
    healer,
    name: personality.name,
    bodies: fighters.map((row) => row.body).sort(),
  };
}

export function healingRequests(healer: string, bodies: string[]) {
  return [
    ["showcase", "rwf admin showcase 16"],
    ["live-status", "rwf admin status"],
    ["save-live", "citizens save"],
    ["registry-live", "npc list"],
    ...bodies.map((body) => [`live-body-${body}`, `execute if entity ${body}`]),
    [
      "apples-before",
      `execute if data entity ${healer} Inventory[{id:"minecraft:golden_apple",count:3}]`,
    ],
    ["health-before", `data get entity ${healer} Health`],
    ["absorption-before", `data get entity ${healer} AbsorptionAmount`],
    ["hurt", `damage ${healer} 12 minecraft:out_of_world`],
    ["health-hurt", `data get entity ${healer} Health`],
    [
      "apples-after",
      `execute if data entity ${healer} Inventory[{id:"minecraft:golden_apple",count:2}]`,
    ],
    ["health-after", `data get entity ${healer} Health`],
    ["absorption-after", `data get entity ${healer} AbsorptionAmount`],
    ["end-status", "rwf admin status"],
    ["save-ended", "citizens save"],
    ["registry-ended", "npc list"],
    ...bodies.map((body) => [
      `ended-body-${body}`,
      `execute if entity ${body}`,
    ]),
    ["end-debug", "rwfbots debug"],
  ] as const;
}

function nativeRows(
  rows: NativeCommand[],
  identity: HealingIdentity,
  bodies: string[],
) {
  if (
    JSON.stringify(rows.map((row) => [row.key, row.command])) !==
    JSON.stringify(healingRequests(identity.healer, bodies))
  )
    throw new Error(
      "Healing native requests differ from the original fixed case",
    );
  const indexed = new Map(rows.map((row) => [row.key, row]));
  const get = (key: string) => {
    const row = indexed.get(key);
    if (row === undefined)
      throw new Error(`Original healing request missing: ${key}`);
    return row;
  };
  for (const row of rows.slice(1)) {
    const phase = row.sequence <= 28 ? "LIVE" : "LOBBY";
    if (row.startPhase !== phase || row.endPhase !== phase)
      throw new Error("Healing native checkpoint belongs to another phase");
  }
  for (const body of bodies)
    if (
      get(`live-body-${body}`).response.trim() !== "Test passed. Count: 1" ||
      get(`ended-body-${body}`).response.trim() !== "Test failed"
    )
      throw new Error(
        "Original native healing bodies were absent or survived teardown",
      );
  for (const key of ["apples-before", "apples-after"])
    if (get(key).response.trim() !== "Test passed. Count: 1")
      throw new Error(
        "Original healing apple inventory did not decrease from three to two",
      );
  registryEvidence(get, identity);
  return get;
}

function registryEvidence(
  get: (key: string) => NativeCommand,
  identity: HealingIdentity,
) {
  for (const key of ["registry-live", "registry-ended"])
    if (
      get(key).response.replaceAll(/§./gu, "").trim() !==
      "=====[ NPCs 1/1 ]====="
    )
      throw new Error("Ephemeral healing bots entered the saved NPC registry");
  for (const key of ["save-live", "save-ended"])
    if (
      get(key).response.replaceAll(/§./gu, "").trim() !==
      "Saving Citizens... \nCitizens saved."
    )
      throw new Error("Original Citizens registry was not saved");
  if (
    !get("live-status").response.includes(
      `Match ${identity.match}, map training-yard, 0 humans, 16 bots`,
    ) ||
    !get("end-debug").response.includes("no bots in the match")
  )
    throw new Error(
      "Healing lacks original native roster or empty teardown evidence",
    );
}

function nativeNumber(response: string, name: string) {
  const match =
    /^(?<name>\w+) has the following entity data: (?<value>\d+(?:\.\d+)?)f$/u.exec(
      response.trim(),
    );
  const parsed = z
    .object({ name: z.string(), value: z.coerce.number().nonnegative() })
    .parse(match?.groups);
  if (parsed.name !== name)
    throw new Error("Native healing probe belongs to another body");
  return parsed.value;
}

function nativeHealing(get: (key: string) => NativeCommand, name: string) {
  const before = nativeNumber(get("health-before").response, name);
  const hurt = nativeNumber(get("health-hurt").response, name);
  const after = nativeNumber(get("health-after").response, name);
  const absorptionBefore = nativeNumber(
    get("absorption-before").response,
    name,
  );
  const absorption = nativeNumber(get("absorption-after").response, name);
  if (
    before !== 20 ||
    hurt !== 8 ||
    absorptionBefore !== 0 ||
    absorption !== 4 ||
    after > 20 ||
    after <= hurt ||
    get("hurt").response.trim() !== `Applied 12.0 damage to ${name}`
  )
    throw new Error(
      "Original native healing lacks damage, health recovery or absorption",
    );
  return { before, hurt, after, absorption };
}

function authoredHealing(
  measured: Journal,
  get: (key: string) => NativeCommand,
  healer: string,
) {
  const actions = measured.actions.filter(
    (row) =>
      row.body === healer &&
      row.sequence > get("hurt").startSequence &&
      row.sequence <= get("apples-after").startSequence,
  );
  const start = actions.find((row) => row.authored.includes("StartUse[]"));
  const released = actions.find(
    (row) => row.authored.includes("ReleaseUse[]") && row.absorption === 4,
  );
  if (
    start === undefined ||
    released === undefined ||
    start.kit !== "TROOPER" ||
    start.life !== released.life ||
    start.health !== 8 ||
    start.absorption !== 0 ||
    released.botTick - start.botTick < 32 ||
    !actions.some(
      (row) =>
        row.usingItem &&
        row.sequence > start.sequence &&
        row.sequence < released.sequence,
    ) ||
    actions
      .filter(
        (row) =>
          row.sequence >= start.sequence && row.sequence <= released.sequence,
      )
      .some(
        (row) =>
          row.decision !== "ineligible" ||
          row.ticket !== null ||
          JSON.stringify(row.commands) !== JSON.stringify(row.authored),
      )
  )
    throw new Error(
      "Healing item use was missing, interrupted or overwritten by learned controls",
    );
  return { life: start.life, eatingTicks: released.botTick - start.botTick };
}

function originalStop(
  commands: RegressionCommand[],
  measured: Journal,
  get: (key: string) => NativeCommand,
) {
  const finish = commands.filter((row) => row.command === "finish");
  const stop = measured.transitions.filter((row) => row.event === "Stop");
  const stopped = stop[0];
  if (
    finish.length !== 1 ||
    finish[0]?.state.result !== "stopped" ||
    finish[0].state.phase !== "RESETTING" ||
    stop.length !== 1 ||
    stopped?.phase !== "RESETTING" ||
    stopped.winner !== "" ||
    stopped.fighters.length > 0 ||
    !finish[0].state.transitions.some(
      (row) => row.sequence === stopped.sequence && row.event === "Stop",
    ) ||
    measured.counts.applied === 0 ||
    measured.actions.some((row) => row.sequence > stopped.sequence) ||
    get("absorption-after").endSequence >= stopped.sequence ||
    get("end-status").startSequence < stopped.sequence
  )
    throw new Error(
      "Healing lacks its original one-time stop and retired Java controls",
    );
}

function originalRecording(recording: string, measured: Journal) {
  const rows = recording
    .trim()
    .split("\n")
    .map((row) => row.split("\t"));
  const header = rows[0];
  const members = rows.filter((row) => row[0] === "R");
  const endings = rows.filter((row) => row[0] === "X");
  const first = measured.transitions.find((row) => row.phase === "LIVE");
  const roster = first?.fighters
    .map((row) => `${row.team.toUpperCase()}\t${row.kit}\ttrue`)
    .sort();
  if (
    header?.[0] !== "H" ||
    header[1] !== "3" ||
    header[2] !== measured.match ||
    header[3] !== "training-yard" ||
    endings.length !== 1 ||
    endings[0]?.[2] !== "-" ||
    endings[0][3] !== "STOPPED" ||
    rows.some((row) => row[0] === "N") ||
    members.length !== 16 ||
    new Set(members.map((row) => row[1])).size !== 16 ||
    members.some((row) => !/^p[a-f0-9]{16}$/u.test(row[1] ?? "")) ||
    JSON.stringify(members.map((row) => row.slice(2).join("\t")).sort()) !==
      JSON.stringify(roster)
  )
    throw new Error("Healing lacks its original stopped all-bot recording");
}

/** Replay actual health, inventory, authored item controls, body removal and persisted registry. */
export function healingLifecycle(evidence: {
  commands: unknown;
  native: unknown;
  identity: unknown;
  recording: string;
  npcSave: string;
}) {
  const commands = z.array(RegressionCommand).parse(evidence.commands);
  const measured = regressionJournal(commands, "healing-and-lifecycle");
  const identity = HealingIdentity.parse(evidence.identity);
  const first = measured.transitions.find((row) => row.phase === "LIVE");
  if (first === undefined || identity.match !== measured.match)
    throw new Error("Original healing live roster missing");
  const { healer, name, bodies } = healingRoster(
    first.fighters,
    identity.personalities,
  );
  if (healer.body !== identity.healer)
    throw new Error("Original healing selection changed");
  const rows = nativeCommands(
    evidence.native,
    commands,
    measured.match,
    "healing-and-lifecycle",
  );
  const get = nativeRows(rows, identity, bodies);
  const health = nativeHealing(get, name);
  const item = authoredHealing(measured, get, healer.body);
  originalStop(commands, measured, get);
  originalRecording(evidence.recording, measured);
  z.strictObject({}).parse(Bun.YAML.parse(evidence.npcSave));
  return {
    measured,
    healing: {
      healer: healer.body,
      ...health,
      ...item,
      applesBefore: 3,
      applesAfter: 2,
      botsDespawned: bodies.length,
      savedNpcs: 0,
    },
  };
}
