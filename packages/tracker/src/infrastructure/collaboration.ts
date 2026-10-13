import type { ActorEnvelope } from "#shared/actor.ts";
import type { UnitOfWork } from "#application/unit-of-work.ts";
import { TrackerError } from "#domain/error.ts";
import {
  audit,
  commitAttachments,
  findIssue,
  lockIssue,
} from "./issue-repository.ts";
import type { Database } from "./database.ts";

export class Collaboration {
  constructor(
    private readonly database: Database,
    private readonly unit: UnitOfWork,
  ) {}

  async comments(identifier: string) {
    const issue = await findIssue(this.database, identifier);
    return this.database.comment.findMany({
      where: { issueId: issue.id },
      include: { author: true, attachments: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
  }

  comment(
    input: {
      actor: ActorEnvelope;
      identifier: string;
      body: string;
      attachmentIds: string[];
    },
    requestId: string,
  ) {
    return this.unit.run(input.actor, requestId, async (context) => {
      const issue = await findIssue(context.db, input.identifier);
      await context.db
        .$queryRaw`SELECT "id" FROM "Issue" WHERE "id" = ${issue.id} FOR UPDATE`;
      const comment = await context.db.comment.create({
        data: {
          issueId: issue.id,
          authorId: context.actor.id,
          body: input.body,
        },
      });
      await commitAttachments(
        context,
        input.attachmentIds,
        issue.id,
        comment.id,
      );
      await audit(context, {
        entityType: "comment",
        entityId: comment.id,
        issueId: issue.id,
        issueIdentifier: input.identifier,
        action: "created",
        after: comment,
      });
      return comment;
    });
  }

  editComment(
    input: { actor: ActorEnvelope; id: string; body?: string | undefined },
    remove: boolean,
    requestId: string,
  ) {
    return this.unit.run(input.actor, requestId, async (context) => {
      const { db } = context;
      const initial = await db.comment.findUnique({ where: { id: input.id } });
      if (initial === null)
        throw new TrackerError("NOT_FOUND", "Comment not found");
      await db.$queryRaw`SELECT "id" FROM "Issue" WHERE "id" = ${initial.issueId} FOR UPDATE`;
      const before = await db.comment.findUnique({
        where: { id: input.id },
        include: { issue: { include: { team: true } } },
      });
      if (before === null)
        throw new TrackerError("NOT_FOUND", "Comment not found");
      if (remove) await db.comment.delete({ where: { id: input.id } });
      if (!remove && input.body === undefined)
        throw new TrackerError("BAD_REQUEST", "Comment body is required");
      const after = remove
        ? undefined
        : await db.comment.update({
            where: { id: input.id },
            data: { body: input.body ?? before.body, editedAt: new Date() },
          });
      await audit(context, {
        entityType: "comment",
        entityId: before.id,
        issueId: before.issueId,
        issueIdentifier: `${before.issue.team.key}-${String(before.issue.number)}`,
        action: remove ? "deleted" : "updated",
        before,
        ...(after === undefined ? {} : { after }),
      });
      return { deleted: remove, comment: after ?? null };
    });
  }

  relation(
    input: {
      actor: ActorEnvelope;
      identifier: string;
      target: string;
      type: "blocks" | "blocked-by" | "duplicate" | "related";
    },
    requestId: string,
  ) {
    return this.unit.run(input.actor, requestId, async (context) => {
      const first = await findIssue(context.db, input.identifier);
      const second = await findIssue(context.db, input.target);
      for (const id of [first.id, second.id].sort())
        await lockIssue(context.db, id);
      if (first.id === second.id)
        throw new TrackerError(
          "BAD_REQUEST",
          "An issue cannot relate to itself",
        );
      let fromId = first.id;
      let toId = second.id;
      if (
        input.type === "blocked-by" ||
        (input.type === "related" && fromId > toId)
      )
        [fromId, toId] = [toId, fromId];
      const type = input.type === "blocked-by" ? "blocks" : input.type;
      const result = await context.db.issueRelation.upsert({
        where: { fromId_toId_type: { fromId, toId, type } },
        create: { fromId, toId, type },
        update: {},
      });
      await audit(context, {
        entityType: "relation",
        entityId: result.id,
        issueId: first.id,
        issueIdentifier: input.identifier,
        action: "created",
        after: { ...result, target: input.target },
      });
      return result;
    });
  }

  deleteRelation(
    input: { actor: ActorEnvelope; id: string },
    requestId: string,
  ) {
    return this.unit.run(input.actor, requestId, async (context) => {
      const relation = await context.db.issueRelation.findUnique({
        where: { id: input.id },
        include: { from: { include: { team: true } } },
      });
      if (relation === null)
        throw new TrackerError("NOT_FOUND", "Relation not found");
      for (const id of [relation.fromId, relation.toId].sort())
        await lockIssue(context.db, id);
      await context.db.issueRelation.delete({ where: { id: input.id } });
      await audit(context, {
        entityType: "relation",
        entityId: input.id,
        issueId: relation.fromId,
        issueIdentifier: `${relation.from.team.key}-${String(relation.from.number)}`,
        action: "deleted",
        before: relation,
      });
      return { deleted: true };
    });
  }
}
