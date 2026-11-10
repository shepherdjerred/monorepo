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
/** A calendar day, `YYYY-MM-DD`, with no time or time zone. */
export const DueDateSchema = z.iso
  .date()
  .refine((value) => value >= "0001-01-01", "Year must be 0001 or later");
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
  parentIdentifier: IdentifierSchema.nullable().optional(),
  dueDate: DueDateSchema.nullable().optional(),
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
/** One patch for many issues: no per-issue text and no attachments. */
const BulkIssuePatchSchema = UpdateIssueSchema.pick({
  stateName: true,
  stateType: true,
  priority: true,
  assigneeKey: true,
  projectSlug: true,
  addLabels: true,
  removeLabels: true,
  archived: true,
  parentIdentifier: true,
  dueDate: true,
})
  .strict()
  .refine(
    (patch) =>
      Object.values(patch).some((value) =>
        Array.isArray(value) ? value.length > 0 : value !== undefined,
      ),
    "The patch changes nothing",
  );
export const BulkUpdateIssuesSchema = MutationSchema.extend({
  identifiers: z
    .array(IdentifierSchema)
    .min(1)
    .max(250)
    .refine(
      (identifiers) => new Set(identifiers).size === identifiers.length,
      "Identifiers must be unique",
    ),
  /** Per-issue optimistic locks; issues it does not name are not checked. */
  expectedRevisions: z
    .record(IdentifierSchema, z.number().int().positive())
    .default({}),
  patch: BulkIssuePatchSchema,
})
  .strict()
  .refine(
    (input) =>
      Object.keys(input.expectedRevisions).every((key) =>
        input.identifiers.includes(key),
      ),
    {
      path: ["expectedRevisions"],
      message: "expectedRevisions may only name the listed identifiers",
    },
  );
const issueListShape = {
  teamKey: TeamKeySchema.optional(),
  projectSlug: SlugSchema.optional(),
  states: z.array(z.string()).default([]),
  labels: z.array(z.string()).default([]),
  assigneeKey: z.string().optional(),
  creatorKey: z.string().optional(),
  priority: z.number().int().min(0).max(4).optional(),
  search: z.string().max(500).optional(),
  includeArchived: z.boolean().default(false),
  parentIdentifier: IdentifierSchema.optional(),
  hasParent: z.boolean().optional(),
  /** Inclusive bounds; issues without a due date never match. */
  dueBefore: DueDateSchema.optional(),
  dueAfter: DueDateSchema.optional(),
  /** Due strictly before `today`, which the caller supplies. */
  overdue: z.boolean().optional(),
  today: DueDateSchema.optional(),
  sort: z
    .enum(["updated", "created", "priority", "votes", "board", "due"])
    .default("updated"),
  limit: z
    .union([z.number().int().min(1).max(500), z.literal("all")])
    .default(100),
  cursor: z.string().optional(),
};
export const IssueListSchema = z
  .object(issueListShape)
  .refine((input) => input.overdue === undefined || input.today !== undefined, {
    path: ["today"],
    message: "today (YYYY-MM-DD) is required with overdue",
  });

/** Paging and the caller's clock are not part of a saved view. */
const viewParamKeys = [
  ...Object.keys(issueListShape).filter(
    (key) => !["cursor", "limit", "today"].includes(key),
  ),
  "group",
  "view",
];
/** The list URL parameters a view stores: filters plus display options. */
export const ViewParamsSchema = z
  .record(
    z.string(),
    z.union([z.string().max(500), z.array(z.string().max(500)).max(100)]),
  )
  .refine(
    (params) => Object.keys(params).every((key) => viewParamKeys.includes(key)),
    `View parameters allow only: ${viewParamKeys.join(", ")}`,
  );
const viewFields = {
  name: z.string().trim().min(1).max(200),
  icon: z.string().trim().min(1).max(32),
  params: ViewParamsSchema,
  teamKey: TeamKeySchema.nullable(),
};
export const CreateViewSchema = MutationSchema.extend({
  ...viewFields,
  teamKey: viewFields.teamKey.default(null),
});
export const UpdateViewSchema = MutationSchema.extend({
  id: z.string().min(1).max(200),
  ...z.object(viewFields).partial().shape,
});
export const ViewReferenceSchema = MutationSchema.extend({
  id: z.string().min(1).max(200),
});
export const ReorderViewsSchema = MutationSchema.extend({
  ids: z.array(z.string().min(1).max(200)).max(1000),
});
export type CreateViewInput = z.infer<typeof CreateViewSchema>;
export type UpdateViewInput = z.infer<typeof UpdateViewSchema>;
export type ViewReferenceInput = z.infer<typeof ViewReferenceSchema>;
export type ReorderViewsInput = z.infer<typeof ReorderViewsSchema>;
export type IssueListInput = z.infer<typeof IssueListSchema>;
export type CreateIssueInput = z.infer<typeof CreateIssueSchema>;
export type UpdateIssueInput = z.infer<typeof UpdateIssueSchema>;
export type BulkUpdateIssuesInput = z.infer<typeof BulkUpdateIssuesSchema>;
