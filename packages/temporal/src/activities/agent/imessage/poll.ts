import { ApplicationFailure } from "@temporalio/activity";
import { z } from "zod/v4";
import { imessageIngressConfig } from "#config/imessage.ts";
import { blueBubblesRequest } from "#lib/bluebubbles/client.ts";
import {
  BlueBubblesMessageSchema,
  blueBubblesCommand,
} from "#lib/bluebubbles/messages.ts";
import {
  BlueBubblesCursorSchema,
  BlueBubblesPollResultSchema,
  type BlueBubblesCursor,
} from "#shared/agent/agent-chat-imessage.ts";

const BLUEBUBBLES_QUERY_LIMIT = 1000;
const MAX_BLUEBUBBLES_ROW_ID = Number.MAX_SAFE_INTEGER;
const BlueBubblesMessagesSchema = z
  .array(BlueBubblesMessageSchema)
  .max(BLUEBUBBLES_QUERY_LIMIT);

function parseBlueBubblesMessages(value: unknown) {
  const result = BlueBubblesMessagesSchema.safeParse(value);
  if (!result.success) {
    throw ApplicationFailure.nonRetryable(
      "BlueBubbles returned an invalid message payload; cursor was not advanced",
      "BlueBubblesInvalidMessagePayload",
    );
  }
  return result.data;
}

async function highestBlueBubblesRowId(lastRowId: number): Promise<number> {
  let low = lastRowId + 1;
  let high = MAX_BLUEBUBBLES_ROW_ID;
  let highest = lastRowId;
  // BlueBubbles orders message queries by message timestamp, not SQLite ROWID.
  // Ask whether a ROWID range is nonempty to locate a durable initial watermark.
  while (low <= high) {
    const midpoint = low + Math.floor((high - low) / 2);
    const messages = parseBlueBubblesMessages(
      await blueBubblesRequest("/api/v1/message/query", {
        with: ["chats"],
        limit: 1,
        sort: "DESC",
        where: [
          {
            statement: "message.ROWID >= :minimumRowId",
            args: { minimumRowId: midpoint },
          },
        ],
      }),
    );
    if (messages.length === 0) high = midpoint - 1;
    else {
      highest = midpoint;
      low = midpoint + 1;
    }
  }
  return highest;
}

async function initialBlueBubblesPage(cursor: BlueBubblesCursor): Promise<{
  initialized: boolean;
  lastRowId: number;
  initializationHighWaterRowId?: number;
}> {
  const snapshotHighWater = cursor.initialized
    ? undefined
    : (cursor.initializationHighWaterRowId ??
      (await highestBlueBubblesRowId(cursor.lastRowId)));
  const messages = parseBlueBubblesMessages(
    await blueBubblesRequest("/api/v1/message/query", {
      with: ["chats"],
      limit: BLUEBUBBLES_QUERY_LIMIT,
      sort: "DESC",
      where: [
        {
          statement: "message.ROWID > :cursor",
          args: { cursor: cursor.lastRowId },
        },
        ...(snapshotHighWater === undefined
          ? []
          : [
              {
                statement: "message.ROWID <= :initializationHighWater",
                args: { initializationHighWater: snapshotHighWater },
              },
            ]),
      ],
    }),
  );
  if (messages.length === 0) {
    return {
      initialized: true,
      lastRowId: snapshotHighWater ?? cursor.lastRowId,
    };
  }
  const next = Math.max(...messages.map((message) => message.originalROWID));
  if (next <= cursor.lastRowId) {
    throw ApplicationFailure.nonRetryable(
      "BlueBubbles initialization did not advance its ROWID",
      "BlueBubblesInitializationDidNotAdvance",
    );
  }
  if (snapshotHighWater !== undefined && next > snapshotHighWater) {
    throw ApplicationFailure.nonRetryable(
      "BlueBubbles initialization crossed its high-water mark",
      "BlueBubblesInitializationHighWaterViolated",
    );
  }
  const initialized = messages.length < BLUEBUBBLES_QUERY_LIMIT;
  return {
    initialized,
    lastRowId: next,
    ...(initialized
      ? {}
      : { initializationHighWaterRowId: snapshotHighWater ?? next }),
  };
}

export async function pollBlueBubblesMessages(rawCursor: BlueBubblesCursor) {
  const cursor = BlueBubblesCursorSchema.parse(rawCursor);
  const config = await imessageIngressConfig();
  if (!config.enabled || config.owners.length === 0) {
    const progress = await initialBlueBubblesPage(cursor);
    return BlueBubblesPollResultSchema.parse({
      startedAt: cursor.startedAt,
      initialized: progress.initialized,
      lastRowId: progress.lastRowId,
      ...(progress.initializationHighWaterRowId === undefined
        ? {}
        : {
            initializationHighWaterRowId: progress.initializationHighWaterRowId,
          }),
      commands: [],
    });
  }
  const initializing = !cursor.initialized;
  if (initializing) {
    const progress = await initialBlueBubblesPage(cursor);
    return BlueBubblesPollResultSchema.parse({
      startedAt: cursor.startedAt,
      initialized: progress.initialized,
      lastRowId: progress.lastRowId,
      ...(progress.initializationHighWaterRowId === undefined
        ? {}
        : {
            initializationHighWaterRowId: progress.initializationHighWaterRowId,
          }),
      commands: [],
    });
  }
  const messages = parseBlueBubblesMessages(
    await blueBubblesRequest("/api/v1/message/query", {
      with: ["chats"],
      limit: BLUEBUBBLES_QUERY_LIMIT,
      sort: "ASC",
      where: [
        {
          statement: "message.ROWID > :cursor",
          args: { cursor: cursor.lastRowId },
        },
      ],
    }),
  );
  // The API sorts by message time, not ROWID. A full page cannot safely advance a ROWID cursor.
  if (messages.length === BLUEBUBBLES_QUERY_LIMIT)
    throw ApplicationFailure.nonRetryable(
      "BlueBubbles backlog exceeds 999 messages; cursor was not advanced",
      "BlueBubblesBacklogExceeded",
    );
  const batch = messages
    .toSorted((left, right) => left.originalROWID - right.originalROWID)
    .slice(0, 50);
  if (batch.some((message) => message.originalROWID <= cursor.lastRowId))
    throw ApplicationFailure.nonRetryable(
      "BlueBubbles returned a message outside the cursor query",
      "BlueBubblesCursorQueryViolated",
    );
  const commands = batch.flatMap((message) => {
    const command = blueBubblesCommand(message, config.owners);
    return command === undefined ? [] : [command];
  });
  return BlueBubblesPollResultSchema.parse({
    startedAt: cursor.startedAt,
    initialized: true,
    lastRowId: batch.at(-1)?.originalROWID ?? cursor.lastRowId,
    commands,
  });
}
