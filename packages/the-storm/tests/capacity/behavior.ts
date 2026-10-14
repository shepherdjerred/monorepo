import { z } from "zod";
import wire from "#capacity-behavior-wire";
import {
  AuthoredCombatHost,
  AuthoredCombatProfile,
  AuthoredCombatLevers,
  AuthoredCombatStyle,
} from "#maps/combat/wire.ts";
import type { RconClient } from "#e2e/harness/rcon.ts";

export const HostDifficulty = AuthoredCombatHost.shape.currentDifficulty;
/** Existing upstream host default; this candidate does not claim authored Hard competence. */
export const capacityHostDifficulty = HostDifficulty.parse("NORMAL");
export const AuthoredExperienceDescription = z
  .string()
  .regex(
    /^difficulty=(?:easy|normal|hard);style=(?:varied|push|cautious|teamplay);variety=(?:low|medium|high);maps=[a-z0-9,-]*;kits=[a-z0-9,-]*$/u,
  );

function canonicalPool(readout: string): string {
  if (readout === "all") return "";
  const ids = z
    .array(z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u))
    .min(1)
    .parse(readout.split(", "));
  if (
    new Set(ids).size !== ids.length ||
    ids.join(", ") !== ids.toSorted().join(", ")
  )
    throw new Error("Authored settings pool readout is not canonical");
  return ids.join(",");
}

/** Reads the existing frozen runtime display; no assumed default stands in for actual settings. */
export function authoredExperienceFromReadout(reply: string): string {
  const current = [
    ...reply
      .replaceAll(/§./gu, "")
      .matchAll(
        /Current game: (?<difficulty>easy|normal|hard) difficulty, (?<style>varied|push|cautious|teamplay) style, (?<variety>low|medium|high) variety\. Maps: (?<maps>[^.;\n]+); kits: (?<kits>[^.;\n]+)\./gu,
      ),
  ];
  if (current.length !== 1)
    throw new Error("Expected one actual frozen authored settings readout");
  const values = z
    .object({
      difficulty: z.string(),
      style: z.string(),
      variety: z.string(),
      maps: z.string(),
      kits: z.string(),
    })
    .parse(current[0]?.groups);
  return AuthoredExperienceDescription.parse(
    `difficulty=${values.difficulty};style=${values.style};variety=${values.variety};maps=${canonicalPool(values.maps)};kits=${canonicalPool(values.kits)}`,
  );
}
export const CapacityBehaviorCapture = z.strictObject({
  version: z.literal(1),
  kind: z.literal("rwf-capacity-behavior"),
  serverTick: z.number().int().nonnegative(),
  match: z.uuid(),
  phase: z.literal("LIVE"),
  map: z.enum(["apex-expanse", "warlords-castles"]),
  experience: z
    .string()
    .regex(
      /^experience-v1;seed=-?\d+;difficulty=(?:easy|normal|hard);style=(?:varied|push|cautious|teamplay);variety=(?:low|medium|high);maps=[a-z0-9,-]*;kits=[a-z0-9,-]*$/u,
    ),
  experienceFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  host: AuthoredCombatHost,
  humans: z.array(z.uuid()).length(1),
  bots: z.array(z.uuid()).min(1).max(255),
  profiles: z.array(AuthoredCombatProfile).min(1).max(255),
});
export const CapacityBehaviorObservation = z.strictObject({
  observedAt: z.number().int().positive(),
  snapshot: CapacityBehaviorCapture,
});

if (
  JSON.stringify(wire) !==
  JSON.stringify({
    version: 1,
    kind: "rwf-capacity-behavior",
    records: {
      Capture: Object.keys(CapacityBehaviorCapture.shape),
      Host: Object.keys(AuthoredCombatHost.shape),
      Profile: Object.keys(AuthoredCombatProfile.shape),
      Levers: Object.keys(AuthoredCombatLevers.shape),
      Style: Object.keys(AuthoredCombatStyle.shape),
    },
  })
)
  throw new Error("Unsupported capacity behavior wire contract");

/** Require the installed whole roster and actual frozen host band, independently of authored settings. */
export function verifyCapacityBehavior(
  raw: unknown,
  expected: {
    match: string;
    map: string;
    total: number;
    hostDifficulty: z.infer<typeof HostDifficulty>;
    authoredExperience: string;
  },
) {
  const capture = CapacityBehaviorCapture.parse(raw);
  const host = capture.host;
  const bots = new Set(capture.bots);
  const bodies = new Set(capture.profiles.map((profile) => profile.body));
  if (
    capture.match !== expected.match ||
    capture.map !== expected.map ||
    host.match !== expected.match ||
    !host.enabled ||
    !host.locked ||
    host.host !== capture.humans[0] ||
    host.currentDifficulty !== expected.hostDifficulty ||
    host.selectedDifficulty !== expected.hostDifficulty ||
    capture.bots.length !== expected.total - 1 ||
    bots.size !== capture.bots.length ||
    bots.has(capture.humans[0]) ||
    capture.profiles.length !== bots.size ||
    bodies.size !== bots.size ||
    capture.profiles.some((profile) => !bots.has(profile.body)) ||
    new Set(capture.profiles.map((profile) => profile.personality)).size !==
      bots.size
  )
    throw new Error(
      "Capacity behavior differs from the original frozen host/roster candidate",
    );
  if (
    new Bun.CryptoHasher("sha256").update(capture.experience).digest("hex") !==
    capture.experienceFingerprint
  )
    throw new Error(
      "Capacity authored experience differs from its fingerprint",
    );
  if (
    capture.experience.split(";").slice(2).join(";") !==
    AuthoredExperienceDescription.parse(expected.authoredExperience)
  )
    throw new Error(
      "Capacity authored experience differs from the frozen candidate settings",
    );
  return capture;
}

export async function captureCapacityBehavior(
  rcon: RconClient,
  expected: Parameters<typeof verifyCapacityBehavior>[1],
) {
  const snapshot = verifyCapacityBehavior(
    JSON.parse(await rcon.command(`rwfcapacitybehavior ${expected.match}`)),
    expected,
  );
  return CapacityBehaviorObservation.parse({
    observedAt: Date.now(),
    snapshot,
  });
}
