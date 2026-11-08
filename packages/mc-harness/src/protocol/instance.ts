import path from "node:path";
import { z } from "zod";

/** Non-secret bootstrap routing. Absence retains the original default instance. */
const InstanceSchema = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z
    .string()
    .regex(/^[a-z][a-z0-9-]{0,31}$/)
    .optional(),
);

export function instanceDirectory(base: string, instance: unknown): string {
  const name = InstanceSchema.parse(instance);
  return name === undefined ? base : path.join(base, "instances", name);
}

export function instanceOwner(owner: string, instance: unknown): string {
  const name = InstanceSchema.parse(instance);
  return name === undefined ? owner : `${owner}:${name}`;
}
