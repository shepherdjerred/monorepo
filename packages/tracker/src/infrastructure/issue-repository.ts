import { Prisma } from "#generated/prisma/client.ts";
import type { Actor } from "#generated/prisma/client.ts";
import { z } from "zod";
import type { MutationContext } from "#application/unit-of-work.ts";
import { TrackerError } from "#domain/error.ts";
import { diff } from "#domain/diff.ts";
import { identifier, parseIdentifier, searchTokens } from "#domain/issue.ts";
import { StateTypeSchema, type IssueListInput } from "#shared/schema.ts";
import { issuePage } from "./issue-list.ts";
import type { Database } from "./database.ts";

export const issueInclude = {
  team: true,
  state: true,
  project: true,
  creator: true,
  assignee: true,
  labels: { include: { label: true } },
  parent: { select: { number: true, title: true } },
  // Archived sub-issues are not counted towards a parent's progress.
  children: {
    where: { archivedAt: null },
    select: { state: { select: { type: true } } },
  },
} satisfies Prisma.IssueInclude;
export type IssueRecord = Prisma.IssueGetPayload<{
  include: typeof issueInclude;
}>;
export const presentActor = (actor: Actor) => ({
  ...actor,
  firstMetadata: actor.firstMetadata as unknown,
  metadata: actor.metadata as unknown,
});
/** A due date is a calendar day: it crosses the wire as `YYYY-MM-DD`. */
export const dueDateColumn = (value: string | null) =>
  value === null ? null : new Date(`${value}T00:00:00.000Z`);
export const presentIssue = ({ parent, children, ...issue }: IssueRecord) => ({
  ...issue,
  dueDate:
    issue.dueDate === null ? null : issue.dueDate.toISOString().slice(0, 10),
  parent:
    parent === null
      ? null
      : {
          identifier: identifier(issue.team.key, parent.number),
          title: parent.title,
        },
  childCount: children.length,
  completedChildCount: children.filter(
    ({ state }) => state.type === "completed",
  ).length,
  sourceMetadata: issue.sourceMetadata as unknown,
  creator: presentActor(issue.creator),
  assignee: issue.assignee === null ? null : presentActor(issue.assignee),
  identifier: identifier(issue.team.key, issue.number),
  labels: issue.labels.map(({ label }) => label),
});

export function json(value: unknown): Prisma.InputJsonValue {
  const serialized = JSON.stringify(value);
  return z.record(z.string(), z.json()).parse(JSON.parse(serialized));
}

export async function audit(
  context: MutationContext,
  input: {
    entityType: string;
    entityId: string;
    action: string;
    issueId?: string;
    issueIdentifier?: string;
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
  },
) {
  return context.db.event.create({
    data: {
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      actorId: context.actor.id,
      requestId: context.requestId,
      ...(input.issueId === undefined ? {} : { issueId: input.issueId }),
      ...(input.issueIdentifier === undefined
        ? {}
        : { issueIdentifier: input.issueIdentifier }),
      changes: json(diff(input.before ?? {}, input.after ?? {})),
      before: input.before === undefined ? Prisma.DbNull : json(input.before),
      after: input.after === undefined ? Prisma.DbNull : json(input.after),
    },
  });
}

export async function findIssue(
  db: Prisma.TransactionClient,
  reference: string,
) {
  const { teamKey, number } = parseIdentifier(reference);
  const issue = await db.issue.findFirst({
    where: { team: { key: teamKey }, number },
    include: issueInclude,
  });
  if (issue === null)
    throw new TrackerError("NOT_FOUND", `Issue ${reference} not found`);
  return issue;
}

export async function lockIssue(db: Prisma.TransactionClient, id: string) {
  await db.$queryRaw`SELECT "id" FROM "Issue" WHERE "id" = ${id} FOR UPDATE`;
}

export async function resolveState(
  db: Prisma.TransactionClient,
  teamId: string,
  input: { stateName?: string | undefined; stateType?: string | undefined },
) {
  const state = await db.workflowState.findFirst({
    where: {
      teamId,
      ...(input.stateName === undefined ? {} : { name: input.stateName }),
      ...(input.stateType === undefined
        ? {}
        : { type: StateTypeSchema.parse(input.stateType) }),
    },
    orderBy: [{ position: "asc" }, { id: "asc" }],
  });
  if (state === null)
    throw new TrackerError(
      "BAD_REQUEST",
      "Unknown workflow state for this team",
    );
  return state;
}

export async function resolveProject(
  db: Prisma.TransactionClient,
  slug: string | null | undefined,
) {
  if (slug === undefined) return;
  if (slug === null) return null;
  const project = await db.project.findUnique({ where: { slug } });
  if (project === null)
    throw new TrackerError("BAD_REQUEST", `Unknown project ${slug}`);
  return project.id;
}

export async function resolveAssignee(
  db: Prisma.TransactionClient,
  key: string | null | undefined,
) {
  if (key === undefined) return;
  if (key === null) return null;
  const actor = await db.actor.findUnique({ where: { key } });
  if (actor === null)
    throw new TrackerError("BAD_REQUEST", `Unknown actor ${key}`);
  return actor.id;
}

export async function addLabels(
  db: Prisma.TransactionClient,
  issueId: string,
  teamId: string,
  names: string[],
) {
  for (const name of new Set(names)) {
    const label = await db.label.findUnique({
      where: { teamId_name: { teamId, name } },
    });
    if (label === null)
      throw new TrackerError("BAD_REQUEST", `Unknown label ${name}`);
    await db.issueLabel.upsert({
      where: { issueId_labelId: { issueId, labelId: label.id } },
      create: { issueId, labelId: label.id, teamId },
      update: {},
    });
  }
}

export async function commitAttachments(
  context: MutationContext,
  ids: string[],
  issueId: string,
  commentId?: string,
) {
  for (const id of [...new Set(ids)].sort()) {
    await context.db
      .$queryRaw`SELECT "id" FROM "Attachment" WHERE "id" = ${id} FOR UPDATE`;
    const attachment = await context.db.attachment.findUnique({
      where: { id },
    });
    if (
      attachment?.uploaderId !== context.actor.id ||
      attachment.status !== "staged"
    )
      throw new TrackerError(
        "BAD_REQUEST",
        "Attachment is unavailable or already committed",
      );
    await context.db.attachment.update({
      where: { id },
      data: {
        issueId,
        ...(commentId === undefined ? {} : { commentId }),
        status: "committed",
      },
    });
  }
}

export class IssueQueries {
  constructor(readonly database: Database) {}
  async list(input: IssueListInput) {
    const { ids, nextCursor, total } = await issuePage(this.database, input);
    const rows = new Map<string, IssueRecord>();
    // Bounded batches keep a `limit: "all"` read under the bind limit.
    for (let start = 0; start < ids.length; start += 1000)
      for (const row of await this.database.issue.findMany({
        where: { id: { in: ids.slice(start, start + 1000) } },
        include: issueInclude,
      }))
        rows.set(row.id, row);
    return {
      // An issue deleted since the page was read is simply absent.
      items: ids.flatMap((id) => {
        const row = rows.get(id);
        return row === undefined ? [] : [presentIssue(row)];
      }),
      nextCursor,
      total,
    };
  }

  async search(
    query: string,
    teamKey: string | undefined,
    includeArchived: boolean,
  ) {
    const result = await this.list({
      search: query,
      teamKey,
      includeArchived,
      states: [],
      labels: [],
      sort: "updated",
      limit: 30,
    });
    const tokens = searchTokens(query);
    const snippets =
      tokens === ""
        ? []
        : await this.database.$queryRaw<{ id: string; subtitle: string }[]>`
      SELECT "id", ts_headline('english', "description", to_tsquery('english', ${tokens}), 'StartSel=, StopSel=, MaxWords=25, MinWords=8') AS "subtitle"
      FROM "Issue" WHERE "id" IN (${Prisma.join([...result.items.map((item) => item.id), "no-issue"])})`;
    return {
      ...result,
      items: result.items.map((item) => ({
        ...item,
        subtitle:
          snippets.find((snippet) => snippet.id === item.id)?.subtitle ??
          item.description.slice(0, 160),
      })),
    };
  }

  async byIdentifier(
    reference: string,
    viewerActorKey?: string,
    db: Prisma.TransactionClient = this.database,
  ) {
    const issue = await findIssue(db, reference);
    const [children, comments, attachments, votes, relations] =
      await Promise.all([
        db.issue.findMany({
          where: { parentId: issue.id, archivedAt: null },
          include: { state: true, assignee: true },
          orderBy: [
            { state: { position: "asc" } },
            { boardOrder: "asc" },
            { number: "asc" },
          ],
        }),
        db.comment.findMany({
          where: { issueId: issue.id },
          include: { author: true },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        }),
        db.attachment.findMany({
          where: { issueId: issue.id, status: "committed" },
        }),
        db.vote.findMany({
          where: { issueId: issue.id },
          include: { actor: true },
        }),
        db.issueRelation.findMany({
          where: { OR: [{ fromId: issue.id }, { toId: issue.id }] },
          include: {
            from: { include: issueInclude },
            to: { include: issueInclude },
          },
        }),
      ]);
    return {
      ...presentIssue(issue),
      children: children.map((child) => ({
        identifier: identifier(issue.team.key, child.number),
        title: child.title,
        state: child.state,
        priority: child.priority,
        assignee: child.assignee === null ? null : presentActor(child.assignee),
      })),
      comments: comments.map((comment) => ({
        ...comment,
        author: presentActor(comment.author),
      })),
      attachments,
      votes: votes.map((vote) => ({
        ...vote,
        actor: presentActor(vote.actor),
      })),
      viewerVoted: votes.some(({ actor }) => actor.key === viewerActorKey),
      relations: relations.map((relation) => ({
        ...relation,
        from: presentIssue(relation.from),
        to: presentIssue(relation.to),
      })),
    };
  }
}
