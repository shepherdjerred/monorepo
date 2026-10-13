import { z } from "zod";
import {
  StateTypeSchema,
  ImportAttachmentFileSchema,
} from "@shepherdjerred/tracker/contract";

const timestamp = z.iso.datetime({ offset: true });
const nullableTime = timestamp.nullable();
const reference = z.object({ id: z.string() });
const identified = reference.extend({ identifier: z.string() });
const source = { id: z.string(), createdAt: timestamp, updatedAt: timestamp };
const LinearUserSchema = z.looseObject({
  ...source,
  name: z.string(),
  displayName: z.string(),
  app: z.boolean(),
});
const LinearTeamSchema = z.looseObject({
  ...source,
  key: z.enum(["AI", "SJ"]),
  name: z.string(),
});
const LinearStateSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  type: StateTypeSchema,
  color: z.string(),
  position: z.number(),
  team: reference,
});
const LinearLabelSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  color: z.string(),
  team: reference.nullable(),
});
const LinearProjectSchema = z.looseObject({
  ...source,
  name: z.string(),
  description: z.string(),
  content: z.string().nullable(),
  color: z.string(),
  archivedAt: nullableTime,
});
const LinearIssueSchema = z.looseObject({
  ...source,
  identifier: z.string(),
  number: z.number().int().positive(),
  title: z.string(),
  description: z.string().nullable(),
  priority: z.number().int(),
  sortOrder: z.number(),
  team: reference,
  state: reference,
  project: reference.nullable(),
  creator: reference.nullable(),
  assignee: reference.nullable(),
  labelIds: z.array(z.string()),
  startedAt: nullableTime,
  completedAt: nullableTime,
  canceledAt: nullableTime,
  archivedAt: nullableTime,
});
const LinearCommentSchema = z.looseObject({
  ...source,
  body: z.string(),
  editedAt: nullableTime,
  issue: identified.nullable(),
  user: reference.nullable(),
});
const LinearRelationSchema = z.looseObject({
  id: z.string(),
  type: z.enum(["blocks", "duplicate", "related"]),
  issue: identified,
  relatedIssue: identified,
});
const LinearAttachmentSchema = z.looseObject({
  ...source,
  title: z.string(),
  url: z.url(),
  issue: identified,
  creator: reference.nullable(),
});
export const ExportFileSchema = ImportAttachmentFileSchema.extend({
  url: z.url(),
  path: z.string().regex(/^files\/[a-f0-9]{64}$/u),
});
export const LinearExportSchema = z.object({
  schemaVersion: z.literal(1),
  exportedAt: timestamp,
  sharedUserId: z.string(),
  workspace: z.object({ id: z.string(), name: z.string(), urlKey: z.string() }),
  teams: z.array(LinearTeamSchema),
  states: z.array(LinearStateSchema),
  labels: z.array(LinearLabelSchema),
  projects: z.array(LinearProjectSchema),
  users: z.array(LinearUserSchema),
  issues: z.array(LinearIssueSchema),
  comments: z.array(LinearCommentSchema),
  relations: z.array(LinearRelationSchema),
  attachments: z.array(LinearAttachmentSchema),
  files: z.array(ExportFileSchema),
});
export type LinearExport = z.infer<typeof LinearExportSchema>;
export type ExportFile = z.infer<typeof ExportFileSchema>;
