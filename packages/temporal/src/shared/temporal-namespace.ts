import { TemporalNamespaceSchema as SharedTemporalNamespaceSchema } from "@scout-for-lol/temporal";
import { z } from "zod";

export const TemporalNamespaceSchema = z.enum(
  SharedTemporalNamespaceSchema.options,
);
export type TemporalNamespace = z.infer<typeof TemporalNamespaceSchema>;

export const LegacyTemporalNamespaceSchema = z.literal("default");
export type LegacyTemporalNamespace = z.infer<
  typeof LegacyTemporalNamespaceSchema
>;

export const AnyTemporalNamespaceSchema = z.union([
  TemporalNamespaceSchema,
  LegacyTemporalNamespaceSchema,
]);
export type AnyTemporalNamespace = z.infer<typeof AnyTemporalNamespaceSchema>;

export function parseTemporalNamespace(value: unknown): TemporalNamespace {
  return TemporalNamespaceSchema.parse(value);
}

export function parseLegacyTemporalNamespace(
  value: unknown,
): LegacyTemporalNamespace | undefined {
  if (value === undefined || value === "") return undefined;
  return LegacyTemporalNamespaceSchema.parse(value);
}

export function parseAnyTemporalNamespace(
  value: unknown,
): AnyTemporalNamespace {
  return AnyTemporalNamespaceSchema.parse(value);
}

export function temporalNamespacesForMonitoring(
  activeNamespace: TemporalNamespace,
  legacyNamespace: LegacyTemporalNamespace | undefined,
): readonly (TemporalNamespace | LegacyTemporalNamespace)[] {
  const activeNamespaces: readonly TemporalNamespace[] =
    activeNamespace === "dev"
      ? ["dev"]
      : activeNamespace === "prod"
        ? ["prod", "beta"]
        : ["beta"];
  return legacyNamespace === undefined
    ? activeNamespaces
    : [...activeNamespaces, legacyNamespace];
}
