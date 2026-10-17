import { z } from "zod";
import { AvailabilitySchema, VersionSchema } from "#shared/contract.ts";
import { DefaultEditionScopeSchema } from "./scope.ts";
import { ExpectedTargetSchema } from "./commands.ts";

const common = {
  schemaVersion: z.literal(2),
  scope: DefaultEditionScopeSchema,
  expected: ExpectedTargetSchema,
  ownRequests: z.array(
    z.strictObject({
      id: z.uuid(),
      version: VersionSchema,
      active: z.boolean(),
      canCancel: z.boolean(),
    }),
  ),
  allowedProtectiveActions: z.array(
    z.enum(["keep", "pin", "unpin", "cancel_request"]),
  ),
};

export const DefaultTargetViewSchema = z.discriminatedUnion("access", [
  z.strictObject({
    ...common,
    access: z.literal("detail"),
    target: z
      .strictObject({
        generation: VersionSchema,
        availability: AvailabilitySchema,
        lineage: z.enum(["resolved", "unresolved"]),
      })
      .nullable(),
  }),
  z.strictObject({ ...common, access: z.literal("protection_only") }),
]);

export type DefaultTargetView = z.infer<typeof DefaultTargetViewSchema>;
