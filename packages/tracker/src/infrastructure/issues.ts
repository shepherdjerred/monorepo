import { Prisma } from "#generated/prisma/client.ts";
import type { UnitOfWork } from "#application/unit-of-work.ts";
import { TrackerError } from "#domain/error.ts";
import { identifier, midpoint, transitionTimestamps } from "#domain/issue.ts";
import type { CreateIssueInput, UpdateIssueInput } from "#shared/schema.ts";
import type { ActorEnvelope } from "#shared/actor.ts";
import type { Database } from "./database.ts";
import {
  IssueQueries,
  addLabels,
  audit,
  commitAttachments,
  findIssue,
  lockIssue,
  presentIssue,
  resolveAssignee,
  resolveProject,
  resolveState,
} from "./issue-repository.ts";

export class Issues extends IssueQueries {
  constructor(
    database: Database,
    private readonly unit: UnitOfWork,
  ) {
    super(database);
  }
  create(input: CreateIssueInput, requestId: string) {
    return this.unit.run(input.actor, requestId, async (context) => {
      const { db, actor } = context;
      const teams = await db.$queryRaw<
        { id: string; issueCounter: number }[]
      >`UPDATE "Team" SET "issueCounter" = "issueCounter" + 1 WHERE "key" = ${input.teamKey} RETURNING "id", "issueCounter"`;
      const team = teams[0];
      if (team === undefined)
        throw new TrackerError("BAD_REQUEST", `Unknown team ${input.teamKey}`);
      const state = await resolveState(db, team.id, {
        stateName: input.stateName,
        stateType:
          input.stateType ??
          (input.stateName === undefined ? "triage" : undefined),
      });
      await db.$queryRaw`SELECT "id" FROM "WorkflowState" WHERE "id" = ${state.id} FOR UPDATE`;
      const tail = await db.issue.aggregate({
        where: { stateId: state.id },
        _max: { boardOrder: true },
      });
      const issue = await db.issue.create({
        data: {
          teamId: team.id,
          number: team.issueCounter,
          creatorId: actor.id,
          title: input.title,
          description: input.description,
          priority: input.priority,
          stateId: state.id,
          projectId: (await resolveProject(db, input.projectSlug)) ?? null,
          assigneeId: (await resolveAssignee(db, input.assigneeKey)) ?? null,
          boardOrder: (tail._max.boardOrder ?? 0) + 1024,
          ...transitionTimestamps(
            state.type,
            { startedAt: null, completedAt: null, canceledAt: null },
            new Date(),
          ),
        },
      });
      await addLabels(db, issue.id, team.id, input.labels);
      await commitAttachments(context, input.attachmentIds, issue.id);
      const result = presentIssue(
        await findIssue(db, identifier(input.teamKey, issue.number)),
      );
      await audit(context, {
        entityType: "issue",
        entityId: issue.id,
        issueId: issue.id,
        issueIdentifier: result.identifier,
        action: "created",
        after: result,
      });
      return result;
    });
  }

  update(input: UpdateIssueInput, requestId: string) {
    return this.unit.run(input.actor, requestId, async (context) => {
      const { db } = context;
      const initial = await findIssue(db, input.identifier);
      const state =
        input.stateName === undefined && input.stateType === undefined
          ? initial.state
          : await resolveState(db, initial.teamId, input);
      await db.$queryRaw`SELECT "id" FROM "WorkflowState" WHERE "id" IN (${Prisma.join([initial.stateId, state.id].sort())}) ORDER BY "id" FOR UPDATE`;
      await lockIssue(db, initial.id);
      const before = await findIssue(db, input.identifier);
      if (before.stateId !== initial.stateId)
        throw new TrackerError(
          "CONFLICT",
          "The issue moved. Reload before saving.",
        );
      if (
        input.expectedRevision !== undefined &&
        input.expectedRevision !== before.revision
      )
        throw new TrackerError(
          "CONFLICT",
          "This issue changed. Reload before saving.",
        );
      const projectId = await resolveProject(db, input.projectSlug);
      const assigneeId = await resolveAssignee(db, input.assigneeKey);
      await db.issue.update({
        where: { id: before.id },
        data: {
          ...(input.title === undefined ? {} : { title: input.title }),
          ...(input.description === undefined
            ? {}
            : { description: input.description }),
          ...(input.priority === undefined ? {} : { priority: input.priority }),
          ...(projectId === undefined ? {} : { projectId }),
          ...(assigneeId === undefined ? {} : { assigneeId }),
          ...(input.archived === undefined
            ? {}
            : { archivedAt: input.archived ? new Date() : null }),
          stateId: state.id,
          revision: { increment: 1 },
          ...transitionTimestamps(state.type, before, new Date()),
        },
      });
      await db.issueLabel.deleteMany({
        where: {
          issueId: before.id,
          label: { name: { in: input.removeLabels } },
        },
      });
      await addLabels(db, before.id, before.teamId, input.addLabels);
      await commitAttachments(context, input.attachmentIds, before.id);
      const result = presentIssue(await findIssue(db, input.identifier));
      await audit(context, {
        entityType: "issue",
        entityId: before.id,
        issueId: before.id,
        issueIdentifier: input.identifier,
        action: "updated",
        before: presentIssue(before),
        after: result,
      });
      return result;
    });
  }

  move(
    input: {
      actor: ActorEnvelope;
      identifier: string;
      stateId: string;
      beforeId?: string | undefined;
      afterId?: string | undefined;
      expectedRevision: number;
    },
    requestId: string,
  ) {
    return this.unit.run(input.actor, requestId, async (context) => {
      const { db } = context;
      const initial = await findIssue(db, input.identifier);
      const stateIds = [initial.stateId, input.stateId].sort();
      await db.$queryRaw`SELECT "id" FROM "WorkflowState" WHERE "id" IN (${Prisma.join(stateIds)}) ORDER BY "id" FOR UPDATE`;
      await lockIssue(db, initial.id);
      const before = await findIssue(db, input.identifier);
      if (before.revision !== input.expectedRevision)
        throw new TrackerError(
          "CONFLICT",
          "This issue changed. Reload the board.",
        );
      if (before.stateId !== initial.stateId)
        throw new TrackerError(
          "CONFLICT",
          "The issue moved. Reload the board.",
        );
      const state = await db.workflowState.findFirst({
        where: { id: input.stateId, teamId: before.teamId },
      });
      if (state === null)
        throw new TrackerError("BAD_REQUEST", "Unknown state for this team");
      const column = await db.issue.findMany({
        where: { stateId: state.id, id: { not: before.id }, archivedAt: null },
        orderBy: [{ boardOrder: "asc" }, { id: "asc" }],
      });
      const leftIndex =
        input.beforeId === undefined
          ? -1
          : column.findIndex(({ id }) => id === input.beforeId);
      const rightIndex =
        input.afterId === undefined
          ? column.length
          : column.findIndex(({ id }) => id === input.afterId);
      if (
        (input.beforeId !== undefined && leftIndex < 0) ||
        rightIndex < 0 ||
        rightIndex !== leftIndex + 1
      )
        throw new TrackerError(
          "CONFLICT",
          "Board neighbors changed. Reload the board.",
        );
      let order = midpoint(
        column[leftIndex]?.boardOrder,
        column[rightIndex]?.boardOrder,
      );
      if (order === null) {
        for (const [index, issue] of column.entries()) {
          const rebalanced = await db.issue.update({
            where: { id: issue.id },
            data: {
              boardOrder: (index + 1) * 1024,
              revision: { increment: 1 },
            },
          });
          await audit(context, {
            entityType: "issue",
            entityId: issue.id,
            issueId: issue.id,
            issueIdentifier: identifier(before.team.key, issue.number),
            action: "board-rebalanced",
            before: { boardOrder: issue.boardOrder, revision: issue.revision },
            after: {
              boardOrder: rebalanced.boardOrder,
              revision: rebalanced.revision,
            },
          });
        }
        order = midpoint(
          leftIndex < 0 ? undefined : (leftIndex + 1) * 1024,
          rightIndex >= column.length ? undefined : (rightIndex + 1) * 1024,
        );
      }
      if (order === null) throw new Error("Rebalanced board has no midpoint");
      await db.issue.update({
        where: { id: before.id },
        data: {
          stateId: state.id,
          boardOrder: order,
          revision: { increment: 1 },
          ...transitionTimestamps(state.type, before, new Date()),
        },
      });
      const result = presentIssue(await findIssue(db, input.identifier));
      await audit(context, {
        entityType: "issue",
        entityId: before.id,
        issueId: before.id,
        issueIdentifier: input.identifier,
        action: "moved",
        before: presentIssue(before),
        after: result,
      });
      return result;
    });
  }

  delete(
    input: {
      actor: ActorEnvelope;
      identifier: string;
      expectedRevision: number;
    },
    requestId: string,
  ) {
    return this.unit.run(input.actor, requestId, async (context) => {
      const before = await findIssue(context.db, input.identifier);
      await context.db
        .$queryRaw`SELECT "id" FROM "WorkflowState" WHERE "id" = ${before.stateId} FOR UPDATE`;
      await lockIssue(context.db, before.id);
      const current = await findIssue(context.db, input.identifier);
      if (current.stateId !== before.stateId)
        throw new TrackerError(
          "CONFLICT",
          "The issue moved. Reload before deleting.",
        );
      if (current.revision !== input.expectedRevision)
        throw new TrackerError(
          "CONFLICT",
          "This issue changed. Reload before deleting.",
        );
      const snapshot = await this.byIdentifier(
        input.identifier,
        undefined,
        context.db,
      );
      await audit(context, {
        entityType: "issue",
        entityId: current.id,
        issueIdentifier: input.identifier,
        action: "deleted",
        before: snapshot,
      });
      await context.db.issue.delete({ where: { id: current.id } });
      return { deleted: true };
    });
  }

  vote(
    input: {
      actor: ActorEnvelope;
      identifier: string;
      note?: string | undefined;
    },
    remove: boolean,
    requestId: string,
  ) {
    return this.unit.run(input.actor, requestId, async (context) => {
      const { db, actor } = context;
      const issue = await findIssue(db, input.identifier);
      await lockIssue(db, issue.id);
      const where = {
        issueId_actorId: { issueId: issue.id, actorId: actor.id },
      };
      const before = await db.vote.findUnique({ where });
      if (remove)
        await db.vote.deleteMany({
          where: { issueId: issue.id, actorId: actor.id },
        });
      else
        await db.vote.upsert({
          where,
          create: {
            issueId: issue.id,
            actorId: actor.id,
            note: input.note ?? null,
          },
          update: input.note === undefined ? {} : { note: input.note },
        });
      const count = await db.vote.count({ where: { issueId: issue.id } });
      if (
        (remove && before !== null) ||
        (!remove &&
          (before === null ||
            (input.note !== undefined && input.note !== before.note)))
      ) {
        await db.issue.update({
          where: { id: issue.id },
          data: { voteCount: count },
        });
        await audit(context, {
          entityType: "vote",
          entityId: `${issue.id}:${actor.id}`,
          issueId: issue.id,
          issueIdentifier: input.identifier,
          action: remove ? "removed" : "cast",
          ...(before === null ? {} : { before }),
          ...(remove ? {} : { after: { note: input.note ?? null } }),
        });
      }
      return { voteCount: count, viewerVoted: !remove };
    });
  }
}
