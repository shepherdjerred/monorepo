import type { Prisma } from "#generated/prisma/client.ts";
import type { ImportRecord } from "#shared/import-schema.ts";
import { TrackerError } from "#domain/error.ts";

export async function importCatalog(
  db: Prisma.TransactionClient,
  record: ImportRecord,
  id: string,
): Promise<string | undefined> {
  switch (record.entityType) {
    case "team": {
      const { key, name, issueCounter } = record.data;
      const team = await db.team.upsert({
        where: { key },
        create: { id, key, name, issueCounter },
        update: { name },
      });
      await db.$executeRaw`UPDATE "Team" SET "issueCounter" = GREATEST("issueCounter", ${issueCounter}) WHERE "id" = ${team.id}`;
      return team.id;
    }
    case "state": {
      const { teamKey, ...data } = record.data;
      const team = await db.team.findUniqueOrThrow({ where: { key: teamKey } });
      const before = await db.workflowState.findUnique({
        where: { teamId_name: { teamId: team.id, name: data.name } },
      });
      if (before !== null && before.type !== data.type)
        throw new TrackerError(
          "CONFLICT",
          "Imported state conflicts with seeded state type",
        );
      const state = await db.workflowState.upsert({
        where: { teamId_name: { teamId: team.id, name: data.name } },
        create: { id, teamId: team.id, ...data },
        update: data,
      });
      return state.id;
    }
    case "label": {
      const { teamKey, ...data } = record.data;
      const team = await db.team.findUniqueOrThrow({ where: { key: teamKey } });
      const label = await db.label.upsert({
        where: { teamId_name: { teamId: team.id, name: data.name } },
        create: { id, teamId: team.id, ...data },
        update: { color: data.color },
      });
      return label.id;
    }
    case "project": {
      const { archivedAt, ...data } = record.data;
      const value = {
        ...data,
        archivedAt: archivedAt === null ? null : new Date(archivedAt),
      };
      const project = await db.project.upsert({
        where: { slug: data.slug },
        create: { id, ...value },
        update: value,
      });
      return project.id;
    }
    case "actor": {
      const { envelope, firstSeenAt, lastSeenAt } = record.data;
      const actor = await db.actor.upsert({
        where: { key: envelope.key },
        create: {
          id,
          ...envelope,
          firstMetadata: envelope.metadata,
          firstSeenAt: new Date(firstSeenAt),
          lastSeenAt: new Date(lastSeenAt),
        },
        update: { name: envelope.name, metadata: envelope.metadata },
      });
      return actor.id;
    }
    case "attachment":
    case "comment":
    case "event":
    case "issue":
    case "relation":
    case "vote":
      return;
  }
}
