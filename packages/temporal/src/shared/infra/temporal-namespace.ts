import { TemporalNamespaceSchema as SharedTemporalNamespaceSchema } from "@scout-for-lol/temporal";
import { z } from "zod";

export const TemporalNamespaceSchema = z.enum(
  SharedTemporalNamespaceSchema.options,
);
export type TemporalNamespace = z.infer<typeof TemporalNamespaceSchema>;

export function parseTemporalNamespace(value: unknown): TemporalNamespace {
  return TemporalNamespaceSchema.parse(value);
}

export function temporalNamespacesForMonitoring(
  activeNamespace: TemporalNamespace,
): readonly TemporalNamespace[] {
  return activeNamespace === "dev"
    ? ["dev"]
    : activeNamespace === "prod"
      ? ["prod", "beta"]
      : ["beta"];
}
