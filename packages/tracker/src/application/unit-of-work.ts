import type { Prisma, Actor } from "#generated/prisma/client.ts";
import type { ActorEnvelope } from "#shared/actor.ts";

export type MutationContext = {
  db: Prisma.TransactionClient;
  actor: Actor;
  requestId: string;
};
export type UnitOfWork = {
  run: <T>(
    actor: ActorEnvelope,
    requestId: string,
    work: (context: MutationContext) => Promise<T>,
  ) => Promise<T>;
};
