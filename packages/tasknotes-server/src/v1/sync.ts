import { z } from "zod";
import type { SyncRequest, SyncResponse } from "../protocol/generated.ts";
import type { MutationAction } from "./auth-types.ts";
import {
  ValidatedSyncCommandSchema,
  type ValidatedSyncCommand,
} from "./schemas.ts";
import { commandHandlers } from "./sync-handlers.ts";
import type { FacetStore } from "./types.ts";

const SYNC_ACTION_HINTS: Partial<
  Record<ValidatedSyncCommand["type"], MutationAction>
> = {
  TaskComplete: "complete",
  TaskUncomplete: "uncomplete",
  TaskReorder: "reorder",
  TaskMove: "move",
  TaskReschedule: "reschedule",
};

function syncCommandActionHint(
  commandType: ValidatedSyncCommand["type"],
): MutationAction | undefined {
  return SYNC_ACTION_HINTS[commandType];
}

const ArgsTempIdSchema = z.object({
  temp_id: z.string().optional(),
});

type IncomingQueuedCommand = {
  uuid: string;
  temp_id?: string | undefined;
  command: {
    type: string;
    args: unknown;
  };
};

export type ExecutableSyncRequest = {
  sync_token?: string | undefined;
  resource_types?: string[] | undefined;
  commands?: IncomingQueuedCommand[] | SyncRequest["commands"] | undefined;
};

function extractArgsTempId(args: unknown): string | undefined {
  const parsed = ArgsTempIdSchema.safeParse(args);
  return parsed.success ? parsed.data.temp_id : undefined;
}

async function processCommand(
  tx: FacetStore,
  userId: string,
  queued: IncomingQueuedCommand,
  tempIdMapping: Record<string, string>,
): Promise<string> {
  const existing = await tx.getProcessedCommand(queued.uuid);
  if (existing !== null) {
    const replayTempId =
      queued.temp_id ?? extractArgsTempId(queued.command.args);
    if (
      replayTempId !== undefined &&
      replayTempId !== "" &&
      existing.resultId !== null
    ) {
      tempIdMapping[replayTempId] = existing.resultId;
    }
    return existing.status;
  }

  const parsedCommand = ValidatedSyncCommandSchema.safeParse(queued.command);
  if (!parsedCommand.success) {
    const firstIssue =
      parsedCommand.error.issues[0]?.message ?? "invalid command";
    return `error: ${firstIssue}`;
  }

  try {
    const baseAudit = tx.getAuditContext();
    const commandTx =
      baseAudit === undefined
        ? tx
        : tx.withAuditContext({
            ...baseAudit,
            source: "sync",
            commandUuid: queued.uuid,
            actionHint: syncCommandActionHint(parsedCommand.data.type),
          });

    const outcome = await commandTx.runInSavepoint(queued.uuid, async () => {
      const handler = commandHandlers[parsedCommand.data.type];
      return await handler(commandTx, userId, parsedCommand.data, {
        queuedTempId: queued.temp_id,
        tempIdMapping,
      });
    });

    if (
      outcome.tempId !== undefined &&
      outcome.tempId !== "" &&
      outcome.createdId !== undefined
    ) {
      tempIdMapping[outcome.tempId] = outcome.createdId;
    }
    await commandTx.recordProcessedCommand(
      queued.uuid,
      userId,
      "ok",
      outcome.createdId ?? null,
    );
    return "ok";
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return `error: ${message}`;
  }
}

export function parseSyncSeqToken(syncToken?: string): bigint | undefined {
  if (syncToken === undefined || syncToken === "" || syncToken === "*") {
    return undefined;
  }
  const match = /^seq:(\d+)$/.exec(syncToken);
  if (match === null) {
    return undefined;
  }
  const seq = BigInt(match[1] ?? "0");
  return seq > 0n ? seq : undefined;
}

export async function executeSync(
  store: FacetStore,
  userId: string,
  request: ExecutableSyncRequest,
): Promise<SyncResponse> {
  return await store.transaction(async (tx) => {
    await tx.getOrCreateUser(userId);

    const tempIdMapping: Record<string, string> = {};
    const syncStatus: Record<string, string> = {};
    const commands = request.commands ?? [];

    for (const queued of commands) {
      if (queued.uuid !== "") {
        syncStatus[queued.uuid] = await processCommand(
          tx,
          userId,
          queued,
          tempIdMapping,
        );
      }
    }

    const sinceSeq = parseSyncSeqToken(request.sync_token);
    const isFullSync = sinceSeq === undefined;
    const filter = {
      userId,
      sinceSeq,
      includeDeleted: !isFullSync,
    };

    const types = request.resource_types;
    const includeAll =
      types === undefined || types.length === 0 || types.includes("all");
    const shouldInclude = (t: string) => includeAll || types.includes(t);

    const tasks = shouldInclude("tasks") ? await tx.listTasks(filter) : [];
    const projects = shouldInclude("projects")
      ? await tx.listProjects(filter)
      : [];
    const sections = shouldInclude("sections")
      ? await tx.listSections(filter)
      : [];
    const labels = shouldInclude("labels") ? await tx.listLabels(filter) : [];
    const reminders = shouldInclude("reminders")
      ? await tx.listReminders(filter)
      : [];
    const filters = shouldInclude("filters")
      ? await tx.listFilters(filter)
      : [];

    const currentSeq = await tx.getSyncSequence(userId);

    return {
      sync_token: `seq:${String(currentSeq)}`,
      full_sync: isFullSync,
      temp_id_mapping: tempIdMapping,
      sync_status: syncStatus,
      tasks,
      projects,
      sections,
      labels,
      reminders,
      filters,
    };
  });
}
