import type { Bot } from "mineflayer";
import { eventually } from "#e2e/harness/rwf-match.ts";
import { AuthoredCombatHost } from "./wire.ts";
import type { z } from "zod";
import { setRwfFeatures, type RwfFeature } from "#e2e/harness/fake-brain.ts";

type Host = z.infer<typeof AuthoredCombatHost>;

/** Enables the public host/voting flow in this disposable producer before its first lobby. */
export async function configureHostFeatures(port: number) {
  const enabled: RwfFeature[] = [
    "the-storm-rwf-match-flow-enabled",
    "the-storm-rwf-host-settings-enabled",
    "the-storm-rwf-candidate-visits-enabled",
  ];
  const previous = await setRwfFeatures(port, enabled);
  return {
    source: "private-flipt-test-double",
    previous,
    enabled,
    appliesBeforeBoot: true,
  };
}

/** Rejects next-round edits: the proof must select the current roster's difficulty. */
export function requireEditableHost(host: Host, human: string) {
  if (!host.enabled || host.host !== human || host.locked)
    throw new Error(
      "Original human must own the unlocked ordinary host settings",
    );
}

/** Uses the same public inventory command and click as a player. Never mutates bot state. */
export async function selectHardHost(
  player: Bot,
  read: () => Promise<unknown>,
) {
  let initial: Host | undefined;
  await eventually(
    "original joined human owns the ordinary lobby",
    async () => {
      const value = AuthoredCombatHost.parse(await read());
      if (value.host === player.player.uuid) {
        initial = value;
        return true;
      }
      return false;
    },
  );
  if (initial === undefined) throw new Error("Original host was not observed");
  const original = initial;
  requireEditableHost(original, player.player.uuid);
  if (
    original.selectedDifficulty !== "NORMAL" ||
    original.currentDifficulty !== "NORMAL"
  )
    throw new Error(
      "Private ordinary lobby must retain the upstream Normal default",
    );
  player.chat("/rwf options");
  await eventually("public Match settings inventory", () => {
    const window = player.currentWindow;
    return Promise.resolve(
      window !== null &&
        JSON.stringify(window.title).includes("Match settings") &&
        window.slots[15]?.name === "iron_sword",
    );
  });
  await player.clickWindow(15, 0, 0);
  let selected: Host | undefined;
  await eventually(
    "public host Hard selection applies before roster freeze",
    async () => {
      const value = AuthoredCombatHost.parse(await read());
      requireEditableHost(value, player.player.uuid);
      if (value.match !== original.match)
        throw new Error("Original host selection crossed a match boundary");
      if (
        value.selectedDifficulty === "HARD" &&
        value.currentDifficulty === "HARD"
      ) {
        selected = value;
        return true;
      }
      return false;
    },
  );
  if (selected === undefined)
    throw new Error("Hard host selection was not observed");
  if (player.currentWindow !== null)
    await player.closeWindow(player.currentWindow);
  return {
    source: "public-host-settings-inventory",
    command: "/rwf options",
    clickedSlot: 15,
    initial,
    selected,
    demonstration: false,
  };
}
