import { Prisma } from "#generated/prisma/client.ts";
import type { Actor } from "#generated/prisma/client.ts";
import { z } from "zod";
import type { MutationContext } from "#application/unit-of-work.ts";
import { TrackerError } from "#domain/error.ts";
import { diff } from "#domain/diff.ts";
import { identifier, parseIdentifier, searchTokens } from "#domain/issue.ts";
import { StateTypeSchema, type IssueListInput } from "#shared/schema.ts";
import type { Database } from "./database.ts";

export const issueInclude = {
  team: true,
  state: true,
  project: true,
  creator: true,
  assignee: true,
  labels: { include: { label: true } },
} satisfies Prisma.IssueInclude;
type IssueRecord = Prisma.IssueGetPayload<{ include: typeof issueInclude }>;
export const presentActor = (actor: Actor) => ({
  ...actor,
  firstMetadata: actor.firstMetadata as unknown,
  metadata: actor.metadata as unknown,
});
export const presentIssue = (issue: IssueRecord) => ({
  ...issue,
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
  async searchIds(value: string): Promise<string[]> {
    if (/^[a-z][a-z0-9]*[- ][1-9]\d*$/iu.test(value.trim())) {
      const ref = parseIdentifier(value);
      const matches = await this.database.issue.findMany({
        where: { team: { key: ref.teamKey }, number: ref.number },
        select: { id: true },
      });
      return matches.map(({ id }) => id);
    }
    const tokens = searchTokens(value);
    if (tokens === "") return [];
    const rows = await this.database.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL pg_trgm.similarity_threshold = 0.25`;
      return tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "Issue" WHERE "searchVector" @@ to_tsquery('english', ${tokens}) OR "title" % ${value}
        ORDER BY GREATEST(ts_rank_cd("searchVector", to_tsquery('english', ${tokens})) * 2, similarity("title", ${value})) DESC,
          ("completedAt" IS NULL AND "canceledAt" IS NULL) DESC, "updatedAt" DESC, "id" ASC`;
    });
    return rows.map(({ id }) => id);
  }

  async list(input: IssueListInput) {
    const ids =
      input.search === undefined || input.search.trim() === ""
        ? undefined
        : await this.searchIds(input.search);
    const where = listWhere(input, ids);
    const sort = {
      updated: "updatedAt",
      created: "createdAt",
      priority: "priority",
      votes: "voteCount",
      board: "boardOrder",
    } as const;
    const field = sort[input.sort];
    const customOrder = ids !== undefined || input.sort === "priority";
    const rows = await this.database.issue.findMany({
      where,
      include: issueInclude,
      orderBy: [
        {
          [field]:
            input.sort === "board" || input.sort === "priority"
              ? "asc"
              : "desc",
        },
        { id: "asc" },
      ],
      ...(customOrder || input.cursor === undefined
        ? {}
        : { cursor: { id: input.cursor }, skip: 1 }),
      ...(customOrder || input.limit === "all"
        ? {}
        : { take: input.limit + 1 }),
    });
    const ordered = customOrder ? customPage(rows, input, ids) : rows;
    const more = input.limit !== "all" && ordered.length > input.limit;
    const page =
      input.limit === "all" ? ordered : ordered.slice(0, input.limit);
    return {
      items: page.map((row) => presentIssue(row)),
      nextCursor: more ? (page.at(-1)?.id ?? null) : null,
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
    const [comments, attachments, votes, relations] = await Promise.all([
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

function customPage(
  rows: IssueRecord[],
  input: IssueListInput,
  searchIds: string[] | undefined,
) {
  const ranks = new Map(searchIds?.map((id, index) => [id, index]));
  rows.sort((a, b) =>
    searchIds === undefined
      ? (a.priority === 0 ? 5 : a.priority) -
          (b.priority === 0 ? 5 : b.priority) || a.id.localeCompare(b.id)
      : (ranks.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
        (ranks.get(b.id) ?? Number.MAX_SAFE_INTEGER),
  );
  if (input.cursor === undefined) return rows;
  const cursor = rows.findIndex((row) => row.id === input.cursor);
  if (cursor === -1)
    throw new TrackerError(
      "BAD_REQUEST",
      "Search cursor is no longer available",
    );
  return rows.slice(cursor + 1);
}

function listWhere(
  input: IssueListInput,
  ids: string[] | undefined,
): Prisma.IssueWhereInput {
  return {
    ...(input.teamKey === undefined ? {} : { team: { key: input.teamKey } }),
    ...(input.projectSlug === undefined
      ? {}
      : { project: { slug: input.projectSlug } }),
    ...(input.assigneeKey === undefined
      ? {}
      : { assignee: { key: input.assigneeKey } }),
    ...(input.creatorKey === undefined
      ? {}
      : { creator: { key: input.creatorKey } }),
    ...(input.priority === undefined ? {} : { priority: input.priority }),
    ...(input.includeArchived ? {} : { archivedAt: null }),
    ...(ids === undefined ? {} : { id: { in: ids } }),
    AND: [
      ...input.labels.map((name) => ({
        labels: { some: { label: { name } } },
      })),
      ...(input.states.length === 0
        ? []
        : [
            {
              OR: input.states.map((state) => {
                const parsed = StateTypeSchema.safeParse(state);
                return parsed.success
                  ? { state: { type: parsed.data } }
                  : { state: { name: state } };
              }),
            },
          ]),
    ],
  };
}
