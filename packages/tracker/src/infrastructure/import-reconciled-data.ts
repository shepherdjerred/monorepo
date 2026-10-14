import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import type { ImportEntity } from "#shared/import-schema.ts";
import { TrackerError } from "#domain/error.ts";
import { importContentHash } from "./import-hash.ts";
import {
  addLabels,
  findIssue,
  json,
  resolveAssignee,
  resolveProject,
  resolveState,
} from "./issue-repository.ts";

export async function reconcileIssueData(
  db: Prisma.TransactionClient,
  previous: ImportEntity<"issue">,
  next: ImportEntity<"issue">,
  id: string,
) {
  await db.$queryRaw`SELECT "id" FROM "Issue" WHERE "id" = ${id} FOR UPDATE`;
  const issue = await findIssue(db, previous.data.identifier);
  if (
    issue.id !== id ||
    issue.revision !== 1 ||
    issue.externalRef !== "linear:" + previous.externalId ||
    importContentHash(currentRecord(previous, issue)) !==
      importContentHash({
        ...previous,
        data: { ...previous.data, labels: [...previous.data.labels].sort() },
      })
  )
    throw new TrackerError(
      "CONFLICT",
      "Imported issue changed outside migration",
    );
  const {
    identifier: _identifier,
    stateName,
    labels,
    projectSlug,
    assigneeKey,
    creatorKey,
    ...data
  } = next.data;
  const state = await resolveState(db, issue.teamId, { stateName });
  const creator = await db.actor.findUniqueOrThrow({
    where: { key: creatorKey },
  });
  await db.issue.update({
    where: { id },
    data: {
      ...data,
      stateId: state.id,
      creatorId: creator.id,
      assigneeId: (await resolveAssignee(db, assigneeKey)) ?? null,
      projectId: (await resolveProject(db, projectSlug)) ?? null,
      sourceMetadata: json(next.rawSourcePayload),
    },
  });
  await db.issueLabel.deleteMany({ where: { issueId: id } });
  await addLabels(db, id, issue.teamId, labels);
  return id;
}

export async function reconcileCommentData(
  db: Prisma.TransactionClient,
  previous: ImportEntity<"comment">,
  next: ImportEntity<"comment">,
  id: string,
) {
  await db.$queryRaw`SELECT "id" FROM "Comment" WHERE "id" = ${id} FOR UPDATE`;
  const comment = await db.comment.findUniqueOrThrow({
    where: { id },
    include: { author: true },
  });
  const issue = await findIssue(db, previous.data.identifier);
  if (
    comment.issueId !== issue.id ||
    comment.body !== previous.data.body ||
    comment.author.key !== previous.data.authorKey ||
    comment.createdAt.toISOString() !== previous.data.createdAt ||
    (comment.editedAt?.toISOString() ?? null) !== previous.data.editedAt
  )
    throw new TrackerError(
      "CONFLICT",
      "Imported comment changed outside migration",
    );
  if (next.data.authorKey !== previous.data.authorKey)
    throw new TrackerError(
      "CONFLICT",
      "Catch-up cannot change a comment author",
    );
  await db.comment.update({
    where: { id },
    data: { body: next.data.body, editedAt: next.data.editedAt },
  });
  return issue.id;
}

function currentRecord(
  previous: ImportEntity<"issue">,
  issue: Awaited<ReturnType<typeof findIssue>>,
): ImportEntity<"issue"> {
  return {
    ...previous,
    rawSourcePayload: z
      .record(z.string(), z.json())
      .parse(issue.sourceMetadata),
    data: {
      identifier: previous.data.identifier,
      title: issue.title,
      description: issue.description,
      priority: issue.priority,
      stateName: issue.state.name,
      projectSlug: issue.project?.slug ?? null,
      creatorKey: issue.creator.key,
      assigneeKey: issue.assignee?.key ?? null,
      labels: issue.labels.map(({ label }) => label.name).sort(),
      boardOrder: issue.boardOrder,
      createdAt: issue.createdAt.toISOString(),
      updatedAt: issue.updatedAt.toISOString(),
      startedAt: issue.startedAt?.toISOString() ?? null,
      completedAt: issue.completedAt?.toISOString() ?? null,
      canceledAt: issue.canceledAt?.toISOString() ?? null,
      archivedAt: issue.archivedAt?.toISOString() ?? null,
    },
  };
}
