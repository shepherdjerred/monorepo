import type { Box, Player } from "#protocol/bridge.ts";
import { boxesOverlap, describeBox, distanceToBox } from "#src/box.ts";
export type ProtectedRegion = { name: string; box: Box };

import { LiveGuardRefusal } from "./guard-errors.ts";

/** Refuses humans inside the box, and near it without --allow-players. NPCs never count. */
export function checkPlayers(
  box: Box,
  humans: readonly Player[],
  options: {
    allowPlayers: boolean;
    radius: number;
    nearbyParticipant: string | undefined;
  },
): void {
  const { allowPlayers, radius, nearbyParticipant } = options;
  const nearby = humans.filter((player) => player.world === box.world);
  const inside = nearby.filter(
    (player) => distanceToBox(box, player.pos) === 0,
  );
  if (inside.length > 0) {
    throw new LiveGuardRefusal(
      `${inside.map((player) => player.name).join(", ")} ${inside.length === 1 ? "is" : "are"} inside ${describeBox(box)}; wait until they leave`,
    );
  }
  const close = nearby.filter(
    (player) =>
      player.uuid !== nearbyParticipant &&
      distanceToBox(box, player.pos) <= radius,
  );
  if (!allowPlayers && close.length > 0) {
    throw new LiveGuardRefusal(
      `${close.map((player) => player.name).join(", ")} within ${radius.toString()} blocks of ${describeBox(box)}; pass --allow-players to proceed anyway`,
    );
  }
}

/** Refuses a box that intersects a protected region unless --allow-protected. */
export function checkProtected(
  box: Box,
  regions: readonly ProtectedRegion[],
  allowProtected: boolean,
): void {
  if (allowProtected) {
    return;
  }
  const hit = regions.filter((region) => boxesOverlap(box, region.box));
  if (hit.length > 0) {
    throw new LiveGuardRefusal(
      `${describeBox(box)} intersects protected ${hit.map((region) => `${region.name} (${describeBox(region.box)})`).join(", ")}; pass --allow-protected with a --reason only if the edit is meant for it`,
    );
  }
}
