import { z } from "zod";
import { CommandResultSchema } from "#shared/api.ts";
import {
  CreateRequestSchema,
  MediaActionSchema,
  VersionSchema,
} from "#shared/contract.ts";
import { DefaultEditionScopeSchema } from "./scope.ts";

export const ExpectedTargetSchema = z.strictObject({
  mediaVersion: VersionSchema,
  targetVersion: VersionSchema.nullable(),
});

export const DefaultCommandSchema = z.discriminatedUnion("action", [
  CreateRequestSchema.omit({ mediaId: true }).extend({
    action: z.literal("request"),
  }),
  MediaActionSchema.options[0].omit({ expectedVersion: true }),
  MediaActionSchema.options[1].omit({ expectedVersion: true }),
  MediaActionSchema.options[2].omit({ expectedVersion: true }),
  MediaActionSchema.options[3].omit({ expectedVersion: true }),
  MediaActionSchema.options[4].omit({ expectedVersion: true }),
  MediaActionSchema.options[5].omit({ expectedVersion: true }),
  MediaActionSchema.options[6].omit({ expectedVersion: true }),
  z.strictObject({
    action: z.literal("cancel_request"),
    requestId: z.uuid(),
    requestVersion: VersionSchema,
  }),
]);

export const DefaultCommandV2Schema = z
  .strictObject({
    schemaVersion: z.literal(2),
    scope: DefaultEditionScopeSchema,
    expected: ExpectedTargetSchema,
    command: DefaultCommandSchema,
  })
  .refine(
    (input) =>
      input.expected.targetVersion !== null ||
      ["request", "keep", "pin"].includes(input.command.action),
    {
      message: "This action requires an existing target version",
      path: ["expected", "targetVersion"],
    },
  );

export const DefaultCommandResultV2Schema = z.strictObject({
  schemaVersion: z.literal(2),
  scope: DefaultEditionScopeSchema,
  result: CommandResultSchema.strict(),
  appliedVersions: ExpectedTargetSchema,
});

export type ExpectedTarget = z.infer<typeof ExpectedTargetSchema>;
export type DefaultCommandV2 = z.infer<typeof DefaultCommandV2Schema>;
export type DefaultCommandResultV2 = z.infer<
  typeof DefaultCommandResultV2Schema
>;
