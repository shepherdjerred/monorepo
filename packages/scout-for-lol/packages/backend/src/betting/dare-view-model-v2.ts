import {
  BucksDareV2StateSchema,
  DareCompiledPlanV2Schema,
  DareDeadlineSpecV2Schema,
  DarePollHealthSchema,
  DareProgressSchema,
  DareSqlV3CompilationSchema,
  DareTargetBindingV2Schema,
} from "@scout-for-lol/data";
import { z } from "zod";

const StoredTargetSchema = DareTargetBindingV2Schema.omit({
  accounts: true,
}).extend({
  acceptedAt: z.iso.datetime().nullable(),
  declinedAt: z.iso.datetime().nullable(),
  payout: z.number().int().nullable(),
  fee: z.number().int().nullable(),
});

export const DareViewerRoleSchema = z.enum([
  "member",
  "challenger",
  "target",
  "contributor",
]);
export const DareAvailableActionSchema = z.enum([
  "fund",
  "accept",
  "decline",
  "contribute",
  "cancel",
  "delete_draft",
]);

export const DareV2ListItemSchema = z.strictObject({
  contractVersion: z.union([z.literal(2), z.literal(3)]),
  id: z.number().int().positive(),
  serverId: z.string().min(1),
  state: BucksDareV2StateSchema,
  currentRevision: z.number().int().positive(),
  fundedRevision: z.number().int().positive().nullable(),
  challengerDiscordId: z.string().min(1),
  targetAliases: z.array(z.string().min(1)),
  plainLanguage: z.string().min(1),
  openingStake: z.number().int().positive(),
  potTotal: z.number().int().nonnegative(),
  evidenceGames: z.number().int().nonnegative(),
  progress: DareProgressSchema,
  viewerRoles: z.array(DareViewerRoleSchema),
  availableActions: z.array(DareAvailableActionSchema),
  requiresViewerAction: z.boolean(),
  proposalExpiresAt: z.iso.datetime().nullable(),
  acceptDeadline: z.iso.datetime().nullable(),
  activatedAt: z.iso.datetime().nullable(),
  deadlineAt: z.iso.datetime().nullable(),
  settledAt: z.iso.datetime().nullable(),
  finalValue: z.boolean().nullable(),
  updatedAt: z.iso.datetime(),
});
export type DareV2ListItem = z.infer<typeof DareV2ListItemSchema>;

export const DareV2ListPageSchema = z.strictObject({
  items: z.array(DareV2ListItemSchema),
  nextCursor: z.string().min(1).nullable(),
});
export type DareV2ListPage = z.infer<typeof DareV2ListPageSchema>;

export const DareV2InspectionSchema = DareV2ListItemSchema.extend({
  channelId: z.string().min(1),
  originConversationId: z.string().min(1).nullable(),
  canonicalScoutQl: z.string().min(1),
  plan: z.union([DareCompiledPlanV2Schema, DareSqlV3CompilationSchema]),
  semanticProofPlan: z.string().min(1),
  originalText: z.string().min(1),
  deadlineSpec: DareDeadlineSpecV2Schema,
  compilerVersion: z.string().min(1),
  scoutQlPlanHash: z
    .string()
    .regex(/^[a-f\d]{64}$/)
    .nullable(),
  evaluatorVersion: z.string().min(1),
  targets: z.array(StoredTargetSchema),
  proof: z.json().nullable(),
  voidReason: z.string().nullable(),
  processingHealth: DarePollHealthSchema,
});
export type DareV2Inspection = z.infer<typeof DareV2InspectionSchema>;
