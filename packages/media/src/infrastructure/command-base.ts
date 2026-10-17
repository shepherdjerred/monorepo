import type { Prisma } from "#generated/prisma/client.ts";
import type { MediaActor } from "#application/auth.ts";
import { MediaError } from "#application/errors.ts";
import { tokenHash } from "#application/security.ts";
import type { Database } from "./database.ts";
import { CommandResultSchema } from "#shared/api.ts";
import { isRetryableTransaction } from "./locks.ts";
import { routeNativeQuarantineOperation } from "./native-quarantine/continuation.ts";
type Transaction = Prisma.TransactionClient;
type JsonResult = Prisma.InputJsonObject;
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  return Array.isArray(value)
    ? `[${value.map((item) => canonical(item)).join(",")}]`
    : `{${Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
        .join(",")}}`;
}

export type MediaCommandSettings = {
  keepDays: number;
  serverMachineId?: string;
};

export class MediaCommandBase {
  constructor(
    private readonly database: Database,
    protected readonly settings: MediaCommandSettings,
  ) {}

  protected async command(
    actor: MediaActor,
    key: string,
    command: { kind: string; input: unknown },
    work: (db: Transaction) => Promise<JsonResult>,
  ) {
    const requestHash = tokenHash(canonical(command));
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        return await this.database.$transaction(
          async (db) => {
            const prior = await db.idempotencyRecord.findUnique({
              where: { userId_key: { userId: actor.id, key } },
            });
            if (prior) {
              if (prior.requestHash !== requestHash)
                throw new MediaError(
                  "idempotency_conflict",
                  "Idempotency key was already used for a different command",
                  409,
                );
              return CommandResultSchema.parse(prior.response);
            }
            const result = await work(db);
            await db.idempotencyRecord.create({
              data: { userId: actor.id, key, requestHash, response: result },
            });
            return CommandResultSchema.parse(result);
          },
          { isolationLevel: "Serializable", timeout: 15_000 },
        );
      } catch (error) {
        if (isRetryableTransaction(error) && attempt < 3) continue;
        throw error;
      }
    }
    throw new Error("Transaction retry limit was not enforced");
  }

  protected async enqueue(
    db: Transaction,
    actor: MediaActor,
    command: {
      kind: string;
      mediaId: string;
      generation: number;
      details?: Prisma.InputJsonObject;
    },
  ) {
    const { kind, mediaId, generation, details = {} } = command;
    const operationId = crypto.randomUUID();
    const runtime = await db.mediaRuntimeState.findUniqueOrThrow({
      where: { id: "singleton" },
    });
    const initialPayload = {
      operationId,
      kind,
      mediaId,
      generation,
      recoveryEpoch: runtime.recoveryEpoch,
      ...details,
    };
    const route = await routeNativeQuarantineOperation(db, {
      kind,
      targetId: mediaId,
      payload: initialPayload,
    });
    const selectedKind = route?.kind ?? kind;
    const payload = {
      ...(route?.payload ?? initialPayload),
      kind: selectedKind,
    };
    await db.operation.create({
      data: {
        id: operationId,
        userId: actor.id,
        kind: selectedKind,
        targetId: mediaId,
        payload,
        outbox: { create: { kind: selectedKind, payload } },
      },
    });
    if (route !== null)
      await db.nativeQuarantineContinuation.update({
        where: { id: route.continuationId },
        data: {
          coordinatorOperationId: operationId,
          state: route.state,
          version: { increment: 1 },
        },
      });
    return operationId;
  }
}
