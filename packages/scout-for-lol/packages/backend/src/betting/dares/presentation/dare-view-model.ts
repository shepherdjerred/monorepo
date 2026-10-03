import {
  BucksDareStateSchema,
  DareDeadlineSpecSchema,
  DarePollHealthSchema,
  DareProgressSchema,
  DareSqlCompilationSchema,
  DareTargetBindingSchema,
} from "@scout-for-lol/data";
import { z } from "zod";

const StoredTargetSchema = DareTargetBindingSchema.omit({
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

export const DareListItemSchema = z.strictObject({
  id: z.number().int().positive(),
  serverId: z.string().min(1),
  state: BucksDareStateSchema,
  currentRevision: z.number().int().positive(),
  fundedRevision: z.number().int().positive().nullable(),
  challengerDiscordId: z.string().min(1),
  targetAliases: z.array(z.string().min(1)),
  originalText: z.string().min(1),
  displayTitle: z.string().min(1).nullable(),
  statusPhrases: z.record(z.string().min(1), z.string().min(1)).nullable(),
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
export type DareListItem = z.infer<typeof DareListItemSchema>;

export const DareListPageSchema = z.strictObject({
  items: z.array(DareListItemSchema),
  nextCursor: z.string().min(1).nullable(),
});
export type DareListPage = z.infer<typeof DareListPageSchema>;

export const DareInspectionSchema = DareListItemSchema.extend({
  channelId: z.string().min(1),
  originConversationId: z.string().min(1).nullable(),
  canonicalScoutQl: z.string().min(1),
  plan: DareSqlCompilationSchema,
  semanticProofPlan: z.string().min(1),
  deadlineSpec: DareDeadlineSpecSchema,
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
  activationHealth: z
    .strictObject({
      status: z.enum(["pending", "retrying", "complete"]),
      requestedAt: z.iso.datetime(),
      attemptCount: z.number().int().nonnegative(),
      lastAttemptAt: z.iso.datetime().nullable(),
      nextAttemptAt: z.iso.datetime(),
      errorCode: z.string().nullable(),
      completedAt: z.iso.datetime().nullable(),
    })
    .nullable(),
});
export type DareInspection = z.infer<typeof DareInspectionSchema>;
