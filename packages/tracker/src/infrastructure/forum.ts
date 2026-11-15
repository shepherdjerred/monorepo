import type { Prisma } from "#generated/prisma/client.ts";
import type { UnitOfWork } from "#application/unit-of-work.ts";
import { TrackerError } from "#domain/error.ts";
import {
  CreateForumPostSchema,
  type CreateForumPostInput,
  type UpdateForumPostInput,
  type ForumListInput,
} from "#shared/forum.ts";
import type { z } from "zod";
import type {
  ReplyForumSchema,
  ResolveForumSchema,
  ReopenForumSchema,
} from "#shared/forum.ts";
import { audit, presentActor } from "./issue-repository.ts";
import type { Database } from "./database.ts";

const include = {
  creator: true,
  resolver: true,
} satisfies Prisma.ForumPostInclude;
type Post = Prisma.ForumPostGetPayload<{ include: typeof include }>;
function present(post: Post, now = new Date()) {
  return {
    ...post,
    creator: presentActor(post.creator),
    resolver: post.resolver === null ? null : presentActor(post.resolver),
    expired:
      post.state === "open" &&
      post.kind === "notice" &&
      post.expiresAt !== null &&
      post.expiresAt <= now,
    expiresAt: post.expiresAt?.toISOString() ?? null,
    resolvedAt: post.resolvedAt?.toISOString() ?? null,
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
  };
}

export class Forum {
  constructor(
    private readonly database: Database,
    private readonly unit: UnitOfWork,
  ) {}

  async list(input: ForumListInput, now = new Date()) {
    const and: Prisma.ForumPostWhereInput[] = [];
    if (input.kind !== undefined) and.push({ kind: input.kind });
    if (input.scopes.length > 0)
      and.push({
        OR: [
          { scopes: { isEmpty: true } },
          { scopes: { hasSome: input.scopes } },
        ],
      });
    if (input.state === "active")
      and.push({
        state: "open",
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      });
    if (input.state === "resolved") and.push({ state: "resolved" });
    if (input.state === "expired")
      and.push({ kind: "notice", state: "open", expiresAt: { lte: now } });
    if (input.query !== undefined && input.query !== "") {
      const contains = { contains: input.query, mode: "insensitive" } as const;
      and.push({
        OR: [
          { title: contains },
          { body: contains },
          { exitCondition: contains },
          { replies: { some: { body: contains } } },
        ],
      });
    }
    const where = { AND: and };
    const [rows, total] = await Promise.all([
      this.database.forumPost.findMany({
        where,
        include,
        orderBy: [{ kind: "asc" }, { updatedAt: "desc" }, { id: "asc" }],
        take: input.limit + 1,
        ...(input.cursor === undefined
          ? {}
          : { cursor: { id: input.cursor }, skip: 1 }),
      }),
      this.database.forumPost.count({ where }),
    ]);
    const items = rows.slice(0, input.limit).map((post) => present(post, now));
    return {
      items,
      total,
      nextCursor: rows.length > input.limit ? (items.at(-1)?.id ?? null) : null,
      checkedAt: now.toISOString(),
    };
  }

  async byId(id: string) {
    const post = await this.database.forumPost.findUnique({
      where: { id },
      include: {
        ...include,
        replies: {
          include: { author: true },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        },
      },
    });
    if (post === null)
      throw new TrackerError("NOT_FOUND", "Forum post not found");
    return {
      ...present(post),
      replies: post.replies.map((reply) => ({
        ...reply,
        author: presentActor(reply.author),
        createdAt: reply.createdAt.toISOString(),
      })),
    };
  }

  create(input: CreateForumPostInput, requestId: string) {
    return this.unit.run(input.actor, requestId, async (ctx) => {
      const post = await ctx.db.forumPost.create({
        data: {
          kind: input.kind,
          title: input.title,
          body: input.body,
          scopes: [...new Set(input.scopes)],
          exitCondition: input.exitCondition ?? null,
          expiresAt:
            input.expiresAt === undefined || input.expiresAt === null
              ? null
              : new Date(input.expiresAt),
          creatorId: ctx.actor.id,
        },
        include,
      });
      await audit(ctx, {
        entityType: "forum-post",
        entityId: post.id,
        action: "created",
        after: post,
      });
      return present(post);
    });
  }

  update(input: UpdateForumPostInput, requestId: string) {
    return this.unit.run(input.actor, requestId, async (ctx) => {
      const before = await this.lock(ctx.db, input.id, input.expectedRevision);
      const validation = CreateForumPostSchema.safeParse({
        ...before,
        ...input,
      });
      if (!validation.success)
        throw new TrackerError(
          "BAD_REQUEST",
          validation.error.issues.map(({ message }) => message).join("; "),
        );
      const merged = validation.data;
      const post = await ctx.db.forumPost.update({
        where: { id: input.id },
        data: {
          title: merged.title,
          body: merged.body,
          scopes: [...new Set(merged.scopes)],
          exitCondition: merged.exitCondition ?? null,
          expiresAt:
            merged.expiresAt == null ? null : new Date(merged.expiresAt),
          revision: { increment: 1 },
        },
        include,
      });
      await audit(ctx, {
        entityType: "forum-post",
        entityId: post.id,
        action: "updated",
        before,
        after: post,
      });
      return present(post);
    });
  }

  reply(input: z.infer<typeof ReplyForumSchema>, requestId: string) {
    return this.unit.run(input.actor, requestId, async (ctx) => {
      await this.lock(ctx.db, input.id);
      const reply = await ctx.db.forumReply.create({
        data: { postId: input.id, authorId: ctx.actor.id, body: input.body },
        include: { author: true },
      });
      await ctx.db.forumPost.update({
        where: { id: input.id },
        data: { updatedAt: new Date() },
      });
      await audit(ctx, {
        entityType: "forum-reply",
        entityId: input.id,
        action: "created",
        after: reply,
      });
      return {
        ...reply,
        author: presentActor(reply.author),
        createdAt: reply.createdAt.toISOString(),
      };
    });
  }

  resolve(input: z.infer<typeof ResolveForumSchema>, requestId: string) {
    return this.setState(input, requestId, "resolved", input.note);
  }
  reopen(input: z.infer<typeof ReopenForumSchema>, requestId: string) {
    return this.setState(input, requestId, "open", null);
  }

  private setState(
    input: z.infer<typeof ReopenForumSchema>,
    requestId: string,
    state: "open" | "resolved",
    note: string | null,
  ) {
    return this.unit.run(input.actor, requestId, async (ctx) => {
      const before = await this.lock(ctx.db, input.id, input.expectedRevision);
      if (before.state === state)
        throw new TrackerError("CONFLICT", `Post is already ${state}`);
      const post = await ctx.db.forumPost.update({
        where: { id: input.id },
        data: {
          state,
          resolutionNote: note,
          resolverId: state === "resolved" ? ctx.actor.id : null,
          resolvedAt: state === "resolved" ? new Date() : null,
          revision: { increment: 1 },
        },
        include,
      });
      await audit(ctx, {
        entityType: "forum-post",
        entityId: post.id,
        action: state === "open" ? "reopened" : "resolved",
        before,
        after: post,
      });
      return present(post);
    });
  }

  private async lock(
    db: Prisma.TransactionClient,
    id: string,
    revision?: number,
  ) {
    await db.$queryRaw`SELECT "id" FROM "ForumPost" WHERE "id" = ${id} FOR UPDATE`;
    const post = await db.forumPost.findUnique({ where: { id }, include });
    if (post === null)
      throw new TrackerError("NOT_FOUND", "Forum post not found");
    if (revision !== undefined && revision !== post.revision)
      throw new TrackerError(
        "CONFLICT",
        "Forum post changed; reload before updating",
      );
    return present(post);
  }
}
