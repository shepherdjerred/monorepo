import { z } from "zod";
import { ActorSchema } from "./actor.ts";
import {
  IdentifierSchema,
  TeamKeySchema,
  SlugSchema,
  ColorSchema,
  StateTypeSchema,
} from "./schema.ts";

const timestamp = z.iso.datetime({ offset: true });
const nullableTimestamp = timestamp.nullable();
const actorKey = ActorSchema.shape.key;
const payload = z.record(z.string(), z.json());
export const ImportAttachmentFileSchema = z.object({
  filename: z.string().min(1).max(200),
  contentType: z.string().min(1).max(200),
  sizeBytes: z
    .number()
    .int()
    .nonnegative()
    .max(100 * 1024 * 1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
});
const base = z.object({
  actor: ActorSchema,
  source: z.literal("linear"),
  externalId: z.string().min(1).max(300),
  rawSourcePayload: payload,
});
const team = base.extend({
  entityType: z.literal("team"),
  data: z.object({
    key: TeamKeySchema,
    name: z.string().min(1),
    issueCounter: z.number().int().nonnegative(),
  }),
});
const state = base.extend({
  entityType: z.literal("state"),
  data: z.object({
    teamKey: TeamKeySchema,
    name: z.string().min(1),
    type: StateTypeSchema,
    color: ColorSchema,
    position: z.number().int().nonnegative(),
  }),
});
const label = base.extend({
  entityType: z.literal("label"),
  data: z.object({
    teamKey: TeamKeySchema,
    name: z.string().min(1),
    color: ColorSchema,
  }),
});
const project = base.extend({
  entityType: z.literal("project"),
  data: z.object({
    slug: SlugSchema,
    name: z.string().min(1),
    description: z.string(),
    color: ColorSchema,
    archivedAt: nullableTimestamp,
  }),
});
const actor = base.extend({
  entityType: z.literal("actor"),
  data: z.object({
    envelope: ActorSchema,
    firstSeenAt: timestamp,
    lastSeenAt: timestamp,
  }),
});
const issue = base.extend({
  entityType: z.literal("issue"),
  data: z.object({
    identifier: IdentifierSchema,
    title: z.string().min(1).max(500),
    description: z.string().max(1_000_000),
    stateName: z.string(),
    priority: z.number().int().min(0).max(4),
    projectSlug: SlugSchema.nullable(),
    creatorKey: actorKey,
    assigneeKey: actorKey.nullable(),
    labels: z.array(z.string()),
    boardOrder: z.number(),
    createdAt: timestamp,
    updatedAt: timestamp,
    startedAt: nullableTimestamp,
    completedAt: nullableTimestamp,
    canceledAt: nullableTimestamp,
    archivedAt: nullableTimestamp,
  }),
});
const comment = base.extend({
  entityType: z.literal("comment"),
  data: z.object({
    identifier: IdentifierSchema,
    authorKey: actorKey,
    body: z.string().max(1_000_000),
    createdAt: timestamp,
    editedAt: nullableTimestamp,
  }),
});
const relation = base.extend({
  entityType: z.literal("relation"),
  data: z.object({
    from: IdentifierSchema,
    to: IdentifierSchema,
    type: z.enum(["blocks", "duplicate", "related"]),
  }),
});
const vote = base.extend({
  entityType: z.literal("vote"),
  data: z.object({
    identifier: IdentifierSchema,
    actorKey,
    note: z.string().nullable(),
    createdAt: timestamp,
  }),
});
const event = base.extend({
  entityType: z.literal("event"),
  data: z.object({
    identifier: IdentifierSchema,
    entityType: z.string().min(1),
    entityExternalId: z.string().min(1),
    action: z.string().min(1),
    actorKey,
    occurredAt: timestamp,
    changes: payload,
    before: payload.nullable(),
    after: payload.nullable(),
  }),
});
const attachment = base.extend({
  entityType: z.literal("attachment"),
  data: ImportAttachmentFileSchema.extend({
    identifier: IdentifierSchema,
    commentExternalId: z.string().nullable(),
    uploaderKey: actorKey,
    width: z.number().int().positive().nullable(),
    height: z.number().int().positive().nullable(),
    createdAt: timestamp,
    contentBase64: z.string().max(140_000_000),
  }),
});
export const ImportRecordSchema = z.discriminatedUnion("entityType", [
  team,
  state,
  label,
  project,
  actor,
  issue,
  comment,
  relation,
  vote,
  event,
  attachment,
]);
export type ImportRecord = z.infer<typeof ImportRecordSchema>;
export const ReconcileRecordSchema = z.union([
  z.object({ previous: issue, next: issue }),
  z.object({ previous: comment, next: comment }),
]);
export type ReconcileRecord = z.infer<typeof ReconcileRecordSchema>;
export type ImportEntity<K extends ImportRecord["entityType"]> = Extract<
  ImportRecord,
  { entityType: K }
>;
