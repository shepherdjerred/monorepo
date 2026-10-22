import { z } from "zod";
import wire from "#map-connections-wire";

export const MapConnectionResult = z.strictObject({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
  changed: z.number().int().nonnegative(),
  before: z.string().regex(/^[a-f0-9]{64}$/u),
  after: z.string().regex(/^[a-f0-9]{64}$/u),
});
export const MapConnectionStatus = z.discriminatedUnion("state", [
  z.strictObject({ state: z.enum(["idle", "working", "complete"]) }),
  z.strictObject({ state: z.literal("failed"), message: z.string() }),
]);
const contract = z
  .strictObject({
    version: z.literal(1),
    states: z.array(z.string()),
    result: z.array(z.string()),
  })
  .parse(wire);
if (
  JSON.stringify(contract.result) !==
    JSON.stringify(Object.keys(MapConnectionResult.shape)) ||
  JSON.stringify(contract.states) !==
    JSON.stringify(["idle", "working", "complete", "failed"])
) {
  throw new Error("Map connection contract differs from consumer");
}
