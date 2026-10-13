import { Prisma } from "#generated/prisma/client.ts";
import type { ImportRecord, ImportEntity } from "#shared/import-schema.ts";
import { parseIdentifier } from "#domain/issue.ts";
import { TrackerError } from "#domain/error.ts";
import {
  addLabels,
  findIssue,
  json,
  lockIssue,
  resolveAssignee,
  resolveProject,
  resolveState,
} from "./issue-repository.ts";

async function issue(
  db: Prisma.TransactionClient,
  record: ImportEntity<"issue">,
  id: string,
) {
  const {
    identifier: reference,
    labels,
    stateName,
    projectSlug,
    assigneeKey,
    creatorKey,
    ...data
  } = record.data;
  const { teamKey, number } = parseIdentifier(reference);
  const team = await db.team.findUniqueOrThrow({ where: { key: teamKey } });
  const state = await resolveState(db, team.id, { stateName });
  const creator = await db.actor.findUniqueOrThrow({
    where: { key: creatorKey },
  });
  await db.issue.create({
    data: {
      ...data,
      id,
      number,
      teamId: team.id,
      stateId: state.id,
      creatorId: creator.id,
      assigneeId: (await resolveAssignee(db, assigneeKey)) ?? null,
      projectId: (await resolveProject(db, projectSlug)) ?? null,
      externalRef: `${record.source}:${record.externalId}`,
      sourceMetadata: json(record.rawSourcePayload),
    },
  });
  await addLabels(db, id, team.id, labels);
  await db.$executeRaw`UPDATE "Team" SET "issueCounter" = GREATEST("issueCounter", ${number}) WHERE "id" = ${team.id}`;
  return id;
}
export async function importIssueData(
  db: Prisma.TransactionClient,
  record: ImportRecord,
  id: string,
): Promise<string | undefined> {
  switch (record.entityType) {
    case "issue":
      return issue(db, record, id);
    case "comment": {
      const { identifier, authorKey, ...data } = record.data;
      const parent = await findIssue(db, identifier);
      const author = await db.actor.findUniqueOrThrow({
        where: { key: authorKey },
      });
      await db.comment.create({
        data: { ...data, id, issueId: parent.id, authorId: author.id },
      });
      return id;
    }
    case "relation": {
      const first = await findIssue(db, record.data.from);
      const second = await findIssue(db, record.data.to);
      if (first.id === second.id)
        throw new TrackerError("BAD_REQUEST", "Self relation in import");
      const pair =
        record.data.type === "related"
          ? [first.id, second.id].sort()
          : [first.id, second.id];
      const fromId = pair[0];
      const toId = pair[1];
      if (fromId === undefined || toId === undefined)
        throw new Error("Incomplete relation pair");
      const relation = await db.issueRelation.upsert({
        where: { fromId_toId_type: { fromId, toId, type: record.data.type } },
        create: { id, fromId, toId, type: record.data.type },
        update: {},
      });
      return relation.id;
    }
    case "vote": {
      const parent = await findIssue(db, record.data.identifier);
      await lockIssue(db, parent.id);
      const actor = await db.actor.findUniqueOrThrow({
        where: { key: record.data.actorKey },
      });
      await db.vote.upsert({
        where: { issueId_actorId: { issueId: parent.id, actorId: actor.id } },
        create: {
          issueId: parent.id,
          actorId: actor.id,
          note: record.data.note,
          createdAt: record.data.createdAt,
        },
        update: {},
      });
      const count = await db.vote.count({ where: { issueId: parent.id } });
      // Preserve original updatedAt during import; normal vote mutations use the current time.
      await db.$executeRaw`UPDATE "Issue" SET "voteCount" = ${count} WHERE "id" = ${parent.id}`;
      return `${parent.id}:${actor.id}`;
    }
    case "event": {
      const { identifier, actorKey, entityExternalId, ...data } = record.data;
      const parent = await findIssue(db, identifier);
      const actor = await db.actor.findUniqueOrThrow({
        where: { key: actorKey },
      });
      await db.event.create({
        data: {
          ...data,
          id,
          issueId: parent.id,
          issueIdentifier: identifier,
          entityId: entityExternalId,
          actorId: actor.id,
          requestId: `import:${record.externalId}`,
          sourceIdentity: `${record.source}:${record.externalId}`,
          changes: json(data.changes),
          before: data.before === null ? Prisma.DbNull : json(data.before),
          after: data.after === null ? Prisma.DbNull : json(data.after),
          rawSourcePayload: json(record.rawSourcePayload),
        },
      });
      return id;
    }
    case "actor":
    case "attachment":
    case "label":
    case "project":
    case "state":
    case "team":
      return;
  }
}
