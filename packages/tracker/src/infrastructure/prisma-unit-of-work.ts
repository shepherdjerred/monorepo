import type { UnitOfWork, MutationContext } from "#application/unit-of-work.ts";
import type { ActorEnvelope } from "#shared/actor.ts";
import type { Database } from "./database.ts";

export class PrismaUnitOfWork implements UnitOfWork {
  constructor(private readonly database: Database) {}

  run<T>(
    envelope: ActorEnvelope,
    requestId: string,
    work: (context: MutationContext) => Promise<T>,
  ): Promise<T> {
    return this.database.$transaction(
      async (db) => {
        const actor = await db.actor.upsert({
          where: { key: envelope.key },
          create: {
            ...envelope,
            firstMetadata: envelope.metadata,
            metadata: envelope.metadata,
          },
          update: {
            name: envelope.name,
            kind: envelope.kind,
            metadata: envelope.metadata,
            lastSeenAt: new Date(),
            seenCount: { increment: 1 },
          },
        });
        return work({ db, actor, requestId });
      },
      { timeout: 30_000, maxWait: 30_000 },
    );
  }
}
