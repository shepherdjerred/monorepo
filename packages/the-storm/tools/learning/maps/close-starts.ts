import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import wire from "#learning-close-starts-wire";
import {
  MapScenario,
  sourceScenario,
  validateScenario,
  type MapContent,
} from "./scenario.ts";

const Start = z.strictObject({
  position: z.tuple([z.number(), z.number(), z.number()]),
  yaw: z.number().transform(Math.fround),
  pitch: z.literal(0),
});
const Report = z.strictObject({
  schema: z.literal(1),
  kind: z.literal("rwf-close-starts"),
  map: MapScenario.shape.map,
  blocksSha256: MapScenario.shape.mapSha256,
  starts: z.array(Start).length(2),
});
if (
  wire.schema !== 1 ||
  wire.kind !== "rwf-close-starts" ||
  !isDeepStrictEqual(wire.fields, Object.keys(Report.shape)) ||
  !isDeepStrictEqual(wire.startFields, Object.keys(Start.shape))
)
  throw new Error("Close-start authoring differs from its neutral contract");

/** Bind an offline geometry receipt to unchanged original metadata; native admission is separate. */
export function closeScenario(map: MapContent, raw: unknown): MapScenario {
  const report = Report.parse(raw);
  if (report.map !== map.id || report.blocksSha256 !== map.blocksSha256)
    throw new Error("Close starts differ from original terrain identity");
  const [first, second] = report.starts;
  if (first === undefined || second === undefined)
    throw new Error("Close starts need two positions");
  const dx = second.position[0] - first.position[0];
  const dz = second.position[2] - first.position[2];
  const distance = Math.hypot(dx, dz);
  if (
    first.position[1] !== second.position[1] ||
    distance < wire.minSeparation ||
    distance > wire.maxSeparation
  )
    throw new Error("Close starts violate grounded separation");
  for (const [index, start] of report.starts.entries()) {
    const yaw =
      (Math.atan2(index === 0 ? -dx : dx, index === 0 ? dz : -dz) * 180) /
      Math.PI;
    const difference = ((start.yaw - yaw + 540) % 360) - 180;
    if (Math.abs(difference) > 0.0001)
      throw new Error("Close starts must face one another");
  }
  const source = sourceScenario(map);
  const scenario = MapScenario.parse({
    ...source,
    id: `${map.id}-close-trooper-duel-v1`,
    spawnPolicy: "authored",
    spawns: source.spawns.map((spawn, index) => {
      const at = report.starts[index];
      if (at === undefined) throw new Error("Missing close-start receipt");
      return { ...spawn, ...at };
    }),
  });
  validateScenario(scenario, map);
  return scenario;
}
