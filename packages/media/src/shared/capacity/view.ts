import { z } from "zod";
import {
  CAPACITY_ROLES,
  CapacityRoleSchema,
  CapacityDecimalSchema,
  CapacityMountReasonSchema,
  CapacitySampleReasonSchema,
} from "./contract.ts";

export const CapacityPublicReasonSchema = z.enum([
  ...CapacityMountReasonSchema.options,
  ...CapacitySampleReasonSchema.options,
  "sample_missing",
  "sample_future",
  "epoch_changed",
  "binding_changed",
  "sample_stale",
]);
export const CapacityStateSchema = z.enum([
  "missing",
  "unavailable",
  "future",
  "old_epoch",
  "root_changed",
  "stale",
  "current",
]);
const unavailableReasons = new Set<string>([
  ...CapacityMountReasonSchema.options,
  ...CapacitySampleReasonSchema.options,
]);
export const CapacityRoleViewSchema = z
  .strictObject({
    role: CapacityRoleSchema,
    state: CapacityStateSchema,
    reason: CapacityPublicReasonSchema.nullable(),
    sampledAt: z.iso.datetime().nullable(),
    totalBytes: CapacityDecimalSchema.nullable(),
    availableBytes: CapacityDecimalSchema.nullable(),
  })
  .refine((value) => {
    if (value.state === "current")
      return (
        value.reason === null &&
        value.sampledAt !== null &&
        value.totalBytes !== null &&
        value.availableBytes !== null &&
        BigInt(value.totalBytes) > 0n &&
        BigInt(value.availableBytes) <= BigInt(value.totalBytes)
      );
    if (value.totalBytes !== null || value.availableBytes !== null)
      return false;
    switch (value.state) {
      case "missing":
        return (
          value.reason === "mount_missing" || value.reason === "sample_missing"
        );
      case "future":
        return (
          value.reason === "mount_future" || value.reason === "sample_future"
        );
      case "old_epoch":
        return value.reason === "epoch_changed";
      case "root_changed":
        return value.reason === "binding_changed";
      case "stale":
        return value.reason === "sample_stale";
      case "unavailable":
        return value.reason !== null && unavailableReasons.has(value.reason);
    }
  }, "Inconsistent capacity state");
export const CapacityViewSchema = z.strictObject({
  schemaVersion: z.literal(1),
  samplingEnabled: z.boolean(),
  asOf: z.iso.datetime(),
  roles: z
    .array(CapacityRoleViewSchema)
    .length(2)
    .refine(
      (roles) =>
        roles.every((value, index) => value.role === CAPACITY_ROLES[index]),
      "Expected movies then tv",
    ),
});
export type CapacityPublicReason = z.infer<typeof CapacityPublicReasonSchema>;
export type CapacityRoleView = z.infer<typeof CapacityRoleViewSchema>;
export type CapacityView = z.infer<typeof CapacityViewSchema>;
