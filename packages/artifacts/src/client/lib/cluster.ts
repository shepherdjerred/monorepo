import type { Point } from "./geometry.ts";

export type PinPosition = Point & { readonly id: string };
export type PinCluster = {
  readonly x: number;
  readonly y: number;
  readonly ids: readonly string[];
};

/** Pins closer than this many screen pixels share one marker. */
export const CLUSTER_RADIUS = 24;

/**
 * Groups pins whose centers are within `radius` of a cluster's first pin.
 * Input order is kept, so the cluster's id order is the thread order.
 */
export function clusterPins(
  pins: readonly PinPosition[],
  radius = CLUSTER_RADIUS,
): PinCluster[] {
  const groups: { seed: Point; members: PinPosition[] }[] = [];
  for (const pin of pins) {
    const group = groups.find(
      (candidate) =>
        Math.hypot(candidate.seed.x - pin.x, candidate.seed.y - pin.y) <=
        radius,
    );
    if (group === undefined) groups.push({ seed: pin, members: [pin] });
    else group.members.push(pin);
  }
  return groups.map(({ members }) => ({
    x: members.reduce((sum, pin) => sum + pin.x, 0) / members.length,
    y: members.reduce((sum, pin) => sum + pin.y, 0) / members.length,
    ids: members.map((pin) => pin.id),
  }));
}
