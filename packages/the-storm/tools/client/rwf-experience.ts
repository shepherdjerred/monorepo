import { z } from "zod";
import {
  rwfFeatureFlags,
  setRwfFeatures,
  setRwfKits,
} from "#e2e/harness/fake-brain.ts";
import { rwfTestSettings } from "#e2e/harness/rwf-settings.ts";
import type { RconClient } from "#e2e/harness/rcon.ts";
import type { RwfOverlay } from "#e2e/harness/config-overlays.ts";
import type { gameplayFixtures } from "#e2e/gameplay-fixtures.ts";

/** Production experience timing in a small, disposable native-client roster. */
export const rwfExperienceSettings: RwfOverlay = {
  ...rwfTestSettings,
  countdown: "PT90S",
  voteLead: "PT20S",
  previewLength: "PT30S",
  freezeLength: "PT5S",
  targetCombatants: 8,
  maxCombatants: 8,
  automaticSizing: false,
  maps: ["training-yard", "copperworks", "tidewatch"],
};

/** The standard full-suite producer selects Training Yard; candidate previews retain three maps. */
export function experienceFixtures(
  configs: Awaited<ReturnType<typeof gameplayFixtures>>,
) {
  const { rwfMap: _singleMap, ...retained } = configs;
  return { ...retained, rwf: rwfExperienceSettings };
}

/** UUID int-array decoding preserves signed NBT words and uses the server's actual identity. */
export function playerUuid(reply: string): string {
  const payload = /\[I;\s*(?<words>-?\d+(?:\s*,\s*-?\d+){3})\s*\]/u.exec(reply)
    ?.groups?.["words"];
  if (payload === undefined)
    throw new Error("Native preview UUID response has no NBT int array");
  const words = z
    .tuple([
      z.coerce.number().int().min(-2_147_483_648).max(2_147_483_647),
      z.coerce.number().int().min(-2_147_483_648).max(2_147_483_647),
      z.coerce.number().int().min(-2_147_483_648).max(2_147_483_647),
      z.coerce.number().int().min(-2_147_483_648).max(2_147_483_647),
    ])
    .parse(payload.split(/\s*,\s*/u));
  const hex = words
    .map((word) => (word >>> 0).toString(16).padStart(8, "0"))
    .join("");
  return z
    .uuid()
    .parse(
      `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`,
    );
}

export async function openRwfExperience(
  port: number,
  enabled = true,
): Promise<void> {
  if (!enabled) return;
  await setRwfFeatures(port, [...rwfFeatureFlags]);
}

export async function openRwfPreviewKits(
  port: number,
  rcon: RconClient,
  enabled = true,
): Promise<void> {
  if (!enabled) return;
  const uuid = playerUuid(
    await rcon.command("data get entity StormPreview UUID"),
  );
  await setRwfKits(port, [uuid]);
}
