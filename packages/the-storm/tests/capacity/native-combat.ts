import { createHmac } from "node:crypto";
import { z } from "zod";
import wire from "#capacity-combat-wire";
import { rwfRecordingSalt } from "#e2e/harness/rwf-settings.ts";
import { readRecording } from "#e2e/harness/rwfbots.ts";

const Tick = z.number().int().nonnegative();
const Health = z.number().nonnegative();
const Hit = z.strictObject({
  sequence: Tick,
  serverTick: Tick,
  attacker: z.uuid(),
  victim: z.uuid(),
  cause: z.string().min(1),
  cancelled: z.boolean(),
  beforeHealth: Health,
  beforeAbsorption: Health,
  afterHealth: Health,
  afterAbsorption: Health,
});
export const CapacityCombatCapture = z.strictObject({
  schema: z.literal(1),
  kind: z.literal("rwf-capacity-combat"),
  match: z.uuid(),
  startedTick: Tick,
  sampledTick: Tick,
  human: z.uuid(),
  bots: z.array(z.uuid()).min(1).max(255),
  dropped: Tick,
  pending: Tick,
  hits: z.array(Hit).max(4096),
});

if (
  JSON.stringify(wire) !==
  JSON.stringify({
    version: 1,
    kind: "rwf-capacity-combat",
    maximumRows: 4096,
    damageCauses: ["ENTITY_ATTACK", "PROJECTILE"],
    deathCauses: ["Melee", "Projectile"],
    records: {
      Capture: Object.keys(CapacityCombatCapture.shape),
      Hit: Object.keys(Hit.shape),
    },
  })
)
  throw new Error("Unsupported capacity combat wire contract");

/** The disposable server's existing fixed test salt; no production identity is read. */
function pseudonym(uuid: string): string {
  return `p${createHmac("sha256", rwfRecordingSalt).update(uuid).digest("hex").slice(0, 16)}`;
}

function validateCapture(
  raw: unknown,
  expected: { match: string; total: number },
) {
  const capture = CapacityCombatCapture.parse(raw);
  if (
    capture.match !== expected.match ||
    capture.bots.length !== expected.total - 1 ||
    new Set(capture.bots).size !== capture.bots.length ||
    capture.bots.includes(capture.human) ||
    capture.dropped !== 0 ||
    capture.pending !== 0 ||
    capture.sampledTick < capture.startedTick
  )
    throw new Error(
      "Capacity combat observer has a different match/roster or incomplete journal",
    );
  let tick = capture.startedTick;
  for (const [index, hit] of capture.hits.entries()) {
    if (
      hit.sequence !== index ||
      hit.serverTick < tick ||
      hit.serverTick > capture.sampledTick ||
      hit.victim !== capture.human ||
      !capture.bots.includes(hit.attacker)
    )
      throw new Error(
        "Capacity combat journal has reordered or foreign observations",
      );
    tick = hit.serverTick;
  }
  return capture;
}

/** Require ordinary recorded intent/death plus actual applied bot damage to that same human. */
export function verifyNativeCombat(
  lines: string[],
  raw: unknown,
  expected: { match: string; total: number },
) {
  const capture = validateCapture(raw, expected);
  const headers = lines.filter((line) => line.startsWith("H\t"));
  if (headers.length !== 1 || headers[0]?.split("\t")[2] !== expected.match)
    throw new Error("Capacity combat recording belongs to another match");
  const recording = readRecording(lines);
  const human = pseudonym(capture.human);
  const bots = new Map(capture.bots.map((uuid) => [pseudonym(uuid), uuid]));
  const roster = new Set([human, ...bots.keys()]);
  if (
    recording.roster.size !== expected.total ||
    recording.roster.get(human)?.bot !== false ||
    [...recording.roster].some(
      ([id, member]) => !roster.has(id) || member.bot !== bots.has(id),
    )
  )
    throw new Error(
      "Capacity combat recording and actual observed roster differ",
    );
  for (const [kind, subject, detail] of recording.events) {
    if (kind !== "died" || subject !== human || detail === undefined) continue;
    const separator = detail.indexOf(" ");
    const killer = detail.slice(0, separator);
    const cause = detail.slice(separator + 1);
    const attacker = bots.get(killer);
    if (attacker === undefined || !wire.deathCauses.includes(cause)) continue;
    const attacked = recording.intents.some(
      (intent) =>
        intent.kind === "attack" &&
        intent.pseudonym === killer &&
        intent.target === human,
    );
    const applied = capture.hits.filter(
      (hit) =>
        hit.attacker === attacker &&
        hit.cause === (cause === "Melee" ? "ENTITY_ATTACK" : "PROJECTILE") &&
        hit.beforeHealth + hit.beforeAbsorption >
          hit.afterHealth + hit.afterAbsorption,
    );
    // Cancellation is intentionally allowed: RWF applies its custom damage before canceling vanilla.
    if (attacked && applied.length > 0)
      return { attacked, killed: true, appliedHits: applied.length, killer };
  }
  throw new Error(
    "Native combat requires the same bot's attack intent, applied hit and direct combat death",
  );
}
