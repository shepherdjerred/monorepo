import { z } from "zod";
import { ActorSchema } from "./actor.ts";

export const StateTypeSchema = z.enum([
  "triage",
  "backlog",
  "unstarted",
  "started",
  "completed",
  "canceled",
  "duplicate",
]);
export const IdentifierSchema = z.string().regex(/^[A-Z][A-Z0-9]*-[1-9]\d*$/u);
export const TeamKeySchema = z
  .string()
  .regex(/^[A-Z][A-Z0-9]*$/u)
  .max(20);
export const ColorSchema = z.string().regex(/^#[0-9a-f]{6}$/iu);
export const SlugSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)
  .max(100);
export const MutationSchema = z.object({ actor: ActorSchema });
export const IssueReferenceSchema = z.object({ identifier: IdentifierSchema });
export const IssueFieldsSchema = z.object({
  title: z.string().trim().min(1).max(500),
  description: z.string().max(1_000_000),
  priority: z.number().int().min(0).max(4),
  stateName: z.string().min(1).max(200).optional(),
  stateType: StateTypeSchema.optional(),
  projectSlug: SlugSchema.nullable().optional(),
  assigneeKey: ActorSchema.shape.key.nullable().optional(),
});
export const CreateIssueSchema = MutationSchema.extend({
  teamKey: TeamKeySchema,
  ...IssueFieldsSchema.shape,
  description: IssueFieldsSchema.shape.description.default(""),
  priority: IssueFieldsSchema.shape.priority.default(0),
  labels: z.array(z.string().min(1).max(200)).max(100).default([]),
  attachmentIds: z.array(z.string()).max(100).default([]),
});
export const UpdateIssueSchema = MutationSchema.extend({
  identifier: IdentifierSchema,
  ...IssueFieldsSchema.partial().shape,
  addLabels: z.array(z.string().min(1).max(200)).max(100).default([]),
  removeLabels: z.array(z.string().min(1).max(200)).max(100).default([]),
  archived: z.boolean().optional(),
  expectedRevision: z.number().int().positive().optional(),
  attachmentIds: z.array(z.string()).max(100).default([]),
});
export const IssueListSchema = z.object({
  teamKey: TeamKeySchema.optional(),
  projectSlug: SlugSchema.optional(),
  states: z.array(z.string()).default([]),
  labels: z.array(z.string()).default([]),
  assigneeKey: z.string().optional(),
  creatorKey: z.string().optional(),
  priority: z.number().int().min(0).max(4).optional(),
  search: z.string().max(500).optional(),
  includeArchived: z.boolean().default(false),
  sort: z
    .enum(["updated", "created", "priority", "votes", "board"])
    .default("updated"),
  limit: z
    .union([z.number().int().min(1).max(500), z.literal("all")])
    .default(100),
  cursor: z.string().optional(),
});
export type IssueListInput = z.infer<typeof IssueListSchema>;
export type CreateIssueInput = z.infer<typeof CreateIssueSchema>;
export type UpdateIssueInput = z.infer<typeof UpdateIssueSchema>;
