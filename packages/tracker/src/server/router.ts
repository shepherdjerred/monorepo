import { TRPCError } from "@trpc/server";
import { t, procedure, mutation } from "./rpc.ts";
import { z } from "zod";
import {
  ForumListSchema,
  ForumReferenceSchema,
  CreateForumPostSchema,
  UpdateForumPostSchema,
  ReplyForumSchema,
  ResolveForumSchema,
  ReopenForumSchema,
} from "#shared/forum.ts";
import { presentActor } from "#infrastructure/issue-repository.ts";
import {
  BulkUpdateIssuesSchema,
  ColorSchema,
  CreateIssueSchema,
  CreateViewSchema,
  IdentifierSchema,
  IssueListSchema,
  IssueReferenceSchema,
  MutationSchema,
  ReorderViewsSchema,
  SlugSchema,
  StateTypeSchema,
  TeamKeySchema,
  UpdateIssueSchema,
  UpdateViewSchema,
  ViewReferenceSchema,
} from "#shared/schema.ts";

const teamInput = z.object({ teamKey: TeamKeySchema.optional() }).default({});
const forumProcedure = procedure.use(async ({ ctx, next }) => {
  if (!(await ctx.forumEnabled()))
    throw new TRPCError({ code: "FORBIDDEN", message: "Forum is disabled" });
  return next();
});
const forumMutation = forumProcedure
  .input(MutationSchema)
  .use(async ({ ctx, next }) => {
    if (!(await ctx.writesEnabled()))
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Tracker writes are paused",
      });
    return next();
  });
const eventsInput = z
  .object({
    identifier: IdentifierSchema.optional(),
    actorKey: z.string().optional(),
    cursor: z.string().optional(),
    limit: z.number().int().min(1).max(500).default(100),
  })
  .default({ limit: 100 });
const projectInput = MutationSchema.extend({
  slug: SlugSchema,
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1_000_000).optional(),
  color: ColorSchema.optional(),
  archived: z.boolean().optional(),
});
const labelInput = MutationSchema.extend({
  teamKey: TeamKeySchema,
  name: z.string().min(1).max(200),
  newName: z.string().min(1).max(200).optional(),
  color: ColorSchema.optional(),
});
const stateInput = MutationSchema.extend({
  teamKey: TeamKeySchema,
  id: z.string().optional(),
  name: z.string().min(1).max(200),
  type: StateTypeSchema,
  color: ColorSchema,
  position: z.number().int().nonnegative(),
});
const eventOutput = z.object({
  id: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  issueId: z.string().nullable(),
  issueIdentifier: z.string().nullable(),
  action: z.string(),
  actorId: z.string(),
  occurredAt: z.date(),
  changes: z.unknown(),
  before: z.unknown(),
  after: z.unknown(),
  requestId: z.string(),
  sourceIdentity: z.string().nullable(),
  rawSourcePayload: z.unknown(),
  actor: z.object({
    id: z.string(),
    key: z.string(),
    kind: z.enum(["human", "agent", "runner"]),
    name: z.string(),
    firstSeenAt: z.date(),
    lastSeenAt: z.date(),
    seenCount: z.number(),
    firstMetadata: z.unknown(),
    metadata: z.unknown(),
  }),
});
const activity = procedure
  .input(eventsInput)
  .output(z.array(eventOutput))
  .query(async ({ ctx, input }) => {
    const events = await ctx.issues.database.event.findMany({
      where: {
        ...(input.identifier === undefined
          ? {}
          : { issueIdentifier: input.identifier }),
        ...(input.actorKey === undefined
          ? {}
          : { actor: { key: input.actorKey } }),
      },
      include: { actor: true },
      orderBy: [{ occurredAt: "desc" }, { id: "asc" }],
      take: input.limit,
      ...(input.cursor === undefined
        ? {}
        : { cursor: { id: input.cursor }, skip: 1 }),
    });
    return events.map((event) => ({
      ...event,
      actor: presentActor(event.actor),
      changes: event.changes,
      before: event.before,
      after: event.after,
      rawSourcePayload: event.rawSourcePayload,
    }));
  });

export const appRouter = t.router({
  forum: t.router({
    list: forumProcedure
      .input(ForumListSchema)
      .query(({ ctx, input }) => ctx.forum.list(input)),
    search: forumProcedure
      .input(
        ForumListSchema.extend({
          state: ForumListSchema.shape.state.default("all"),
        }),
      )
      .query(({ ctx, input }) => ctx.forum.list(input)),
    byId: forumProcedure
      .input(ForumReferenceSchema)
      .query(({ ctx, input }) => ctx.forum.byId(input.id)),
    create: forumMutation
      .input(CreateForumPostSchema)
      .mutation(({ ctx, input }) => ctx.forum.create(input, ctx.requestId)),
    update: forumMutation
      .input(UpdateForumPostSchema)
      .mutation(({ ctx, input }) => ctx.forum.update(input, ctx.requestId)),
    reply: forumMutation
      .input(ReplyForumSchema)
      .mutation(({ ctx, input }) => ctx.forum.reply(input, ctx.requestId)),
    resolve: forumMutation
      .input(ResolveForumSchema)
      .mutation(({ ctx, input }) => ctx.forum.resolve(input, ctx.requestId)),
    reopen: forumMutation
      .input(ReopenForumSchema)
      .mutation(({ ctx, input }) => ctx.forum.reopen(input, ctx.requestId)),
  }),
  maintenance: t.router({
    cleanupStaged: mutation.mutation(({ ctx, input }) =>
      ctx.attachments.cleanupStaged(
        new Date(Date.now() - 24 * 60 * 60 * 1000),
        input.actor,
        ctx.requestId,
      ),
    ),
  }),
  meta: t.router({
    bootstrap: procedure.query(async ({ ctx }) => {
      const db = ctx.issues.database;
      const [
        teams,
        states,
        labels,
        projects,
        actors,
        writesEnabled,
        liveUpdatesEnabled,
      ] = await Promise.all([
        db.team.findMany({ orderBy: { key: "asc" } }),
        db.workflowState.findMany({
          orderBy: [{ position: "asc" }, { id: "asc" }],
        }),
        db.label.findMany({ orderBy: { name: "asc" } }),
        db.project.findMany({ orderBy: { name: "asc" } }),
        db.actor.findMany({ orderBy: { name: "asc" } }),
        ctx.writesEnabled(),
        ctx.liveUpdatesEnabled(),
      ]);
      return {
        forumEnabled: await ctx.forumEnabled(),
        teams,
        states,
        labels,
        projects,
        actors: actors.map((actor) => presentActor(actor)),
        views: await ctx.catalog.views.list(db),
        writesEnabled,
        liveUpdatesEnabled,
      };
    }),
  }),
  teams: t.router({
    list: procedure.query(({ ctx }) =>
      ctx.issues.database.team.findMany({ orderBy: { key: "asc" } }),
    ),
  }),
  states: t.router({
    list: procedure.input(teamInput).query(({ ctx, input }) =>
      ctx.issues.database.workflowState.findMany({
        where:
          input.teamKey === undefined ? {} : { team: { key: input.teamKey } },
        orderBy: [{ position: "asc" }, { id: "asc" }],
      }),
    ),
    create: mutation
      .input(stateInput.omit({ id: true }))
      .mutation(({ ctx, input }) => ctx.catalog.state(input, ctx.requestId)),
    update: mutation
      .input(stateInput.required({ id: true }))
      .mutation(({ ctx, input }) => ctx.catalog.state(input, ctx.requestId)),
    reorder: mutation
      .input(
        z.object({ teamKey: TeamKeySchema, ids: z.array(z.string()).max(100) }),
      )
      .mutation(({ ctx, input }) => ctx.catalog.reorder(input, ctx.requestId)),
  }),
  labels: t.router({
    list: procedure.input(teamInput).query(({ ctx, input }) =>
      ctx.issues.database.label.findMany({
        where:
          input.teamKey === undefined ? {} : { team: { key: input.teamKey } },
        orderBy: { name: "asc" },
      }),
    ),
    create: mutation
      .input(labelInput)
      .mutation(({ ctx, input }) =>
        ctx.catalog.label(input, "create", ctx.requestId),
      ),
    update: mutation
      .input(labelInput)
      .mutation(({ ctx, input }) =>
        ctx.catalog.label(input, "update", ctx.requestId),
      ),
    delete: mutation
      .input(labelInput)
      .mutation(({ ctx, input }) =>
        ctx.catalog.label(input, "delete", ctx.requestId),
      ),
  }),
  projects: t.router({
    list: procedure
      .input(
        z
          .object({ includeArchived: z.boolean().default(false) })
          .default({ includeArchived: false }),
      )
      .query(({ ctx, input }) =>
        ctx.issues.database.project.findMany({
          where: input.includeArchived ? {} : { archivedAt: null },
          orderBy: { name: "asc" },
        }),
      ),
    bySlug: procedure
      .input(z.object({ slug: SlugSchema }))
      .query(({ ctx, input }) =>
        ctx.issues.database.project.findUniqueOrThrow({
          where: { slug: input.slug },
        }),
      ),
    create: mutation
      .input(projectInput.required({ name: true, color: true }))
      .mutation(({ ctx, input }) =>
        ctx.catalog.project(input, true, ctx.requestId),
      ),
    update: mutation
      .input(projectInput)
      .mutation(({ ctx, input }) =>
        ctx.catalog.project(input, false, ctx.requestId),
      ),
    archive: mutation
      .input(
        z.object({ slug: SlugSchema, archived: z.boolean().default(true) }),
      )
      .mutation(({ ctx, input }) =>
        ctx.catalog.project(input, false, ctx.requestId),
      ),
  }),
  views: t.router({
    list: procedure
      .input(teamInput)
      .query(({ ctx, input }) =>
        ctx.catalog.views.list(ctx.issues.database, input.teamKey),
      ),
    create: mutation
      .input(CreateViewSchema)
      .mutation(({ ctx, input }) =>
        ctx.catalog.views.create(input, ctx.requestId),
      ),
    update: mutation
      .input(UpdateViewSchema)
      .mutation(({ ctx, input }) =>
        ctx.catalog.views.update(input, ctx.requestId),
      ),
    delete: mutation
      .input(ViewReferenceSchema)
      .mutation(({ ctx, input }) =>
        ctx.catalog.views.delete(input, ctx.requestId),
      ),
    reorder: mutation
      .input(ReorderViewsSchema)
      .mutation(({ ctx, input }) =>
        ctx.catalog.views.reorder(input, ctx.requestId),
      ),
  }),
  issues: t.router({
    list: procedure
      .input(IssueListSchema)
      .query(({ ctx, input }) => ctx.issues.list(input)),
    byIdentifier: procedure
      .input(
        IssueReferenceSchema.extend({ viewerActorKey: z.string().optional() }),
      )
      .query(({ ctx, input }) =>
        ctx.issues.byIdentifier(input.identifier, input.viewerActorKey),
      ),
    create: mutation
      .input(CreateIssueSchema)
      .mutation(({ ctx, input }) => ctx.issues.create(input, ctx.requestId)),
    update: mutation
      .input(UpdateIssueSchema)
      .mutation(({ ctx, input }) => ctx.issues.update(input, ctx.requestId)),
    bulkUpdate: mutation
      .input(BulkUpdateIssuesSchema)
      .mutation(({ ctx, input }) =>
        ctx.issues.bulkUpdate(input, ctx.requestId),
      ),
    move: mutation
      .input(
        IssueReferenceSchema.extend({
          stateId: z.string(),
          beforeId: z.string().optional(),
          afterId: z.string().optional(),
          expectedRevision: z.number().int().positive(),
        }),
      )
      .mutation(({ ctx, input }) => ctx.issues.move(input, ctx.requestId)),
    delete: mutation
      .input(
        IssueReferenceSchema.extend({
          expectedRevision: z.number().int().positive(),
        }),
      )
      .mutation(({ ctx, input }) => ctx.issues.delete(input, ctx.requestId)),
    activity,
    history: activity,
  }),
  comments: t.router({
    list: procedure
      .input(IssueReferenceSchema)
      .query(({ ctx, input }) => ctx.collaboration.comments(input.identifier)),
    create: mutation
      .input(
        IssueReferenceSchema.extend({
          body: z.string().trim().min(1).max(1_000_000),
          attachmentIds: z.array(z.string()).max(100).default([]),
        }),
      )
      .mutation(({ ctx, input }) =>
        ctx.collaboration.comment(input, ctx.requestId),
      ),
    update: mutation
      .input(
        z.object({
          id: z.string(),
          body: z.string().trim().min(1).max(1_000_000),
        }),
      )
      .mutation(({ ctx, input }) =>
        ctx.collaboration.editComment(input, false, ctx.requestId),
      ),
    delete: mutation
      .input(z.object({ id: z.string() }))
      .mutation(({ ctx, input }) =>
        ctx.collaboration.editComment(input, true, ctx.requestId),
      ),
  }),
  relations: t.router({
    create: mutation
      .input(
        IssueReferenceSchema.extend({
          target: IdentifierSchema,
          type: z.enum(["blocks", "blocked-by", "duplicate", "related"]),
        }),
      )
      .mutation(({ ctx, input }) =>
        ctx.collaboration.relation(input, ctx.requestId),
      ),
    delete: mutation
      .input(z.object({ id: z.string() }))
      .mutation(({ ctx, input }) =>
        ctx.collaboration.deleteRelation(input, ctx.requestId),
      ),
  }),
  votes: t.router({
    cast: mutation
      .input(
        IssueReferenceSchema.extend({
          note: z.string().max(10_000).optional(),
        }),
      )
      .mutation(({ ctx, input }) =>
        ctx.issues.vote(input, false, ctx.requestId),
      ),
    remove: mutation
      .input(IssueReferenceSchema)
      .mutation(({ ctx, input }) =>
        ctx.issues.vote(input, true, ctx.requestId),
      ),
  }),
  search: t.router({
    query: procedure
      .input(
        z.object({
          query: z.string().max(500),
          teamKey: TeamKeySchema.optional(),
          includeArchived: z.boolean().default(false),
        }),
      )
      .query(({ ctx, input }) =>
        ctx.issues.search(input.query, input.teamKey, input.includeArchived),
      ),
  }),
  actors: t.router({
    votes: procedure
      .input(z.object({ key: z.string() }))
      .query(async ({ ctx, input }) => {
        const votes = await ctx.issues.database.vote.findMany({
          where: { actor: { key: input.key } },
          include: { issue: { include: { team: true } } },
          orderBy: { createdAt: "desc" },
        });
        return votes.map((vote) => ({
          identifier: `${vote.issue.team.key}-${String(vote.issue.number)}`,
          title: vote.issue.title,
          note: vote.note,
          createdAt: vote.createdAt,
        }));
      }),
    list: procedure.query(async ({ ctx }) => {
      const actors = await ctx.issues.database.actor.findMany({
        orderBy: [{ lastSeenAt: "desc" }, { id: "asc" }],
      });
      return actors.map((actor) => presentActor(actor));
    }),
    byKey: procedure
      .input(z.object({ key: z.string() }))
      .query(async ({ ctx, input }) =>
        presentActor(
          await ctx.issues.database.actor.findUniqueOrThrow({
            where: { key: input.key },
          }),
        ),
      ),
    activity,
  }),
  events: t.router({ list: activity }),
});

export type AppRouter = typeof appRouter;
