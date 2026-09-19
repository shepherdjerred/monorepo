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

async function initialBlueBubblesRowId(): Promise<number> {
  let watermark = 0;
  for (;;) {
    const messages = z
      .array(BlueBubblesMessageSchema)
      .max(BLUEBUBBLES_QUERY_LIMIT)
      .parse(
        await blueBubblesRequest("/api/v1/message/query", {
          with: ["chats"],
          limit: BLUEBUBBLES_QUERY_LIMIT,
          sort: "DESC",
          where: [
            {
              statement: "message.ROWID > :cursor",
              args: { cursor: watermark },
            },
          ],
        }),
      );
    if (messages.length === 0) return watermark;
    const next = Math.max(...messages.map((message) => message.originalROWID));
    if (next <= watermark) {
      throw new Error("BlueBubbles initialization did not advance its ROWID");
    }
    watermark = next;
    if (messages.length < BLUEBUBBLES_QUERY_LIMIT) return watermark;
  }
}

export async function pollBlueBubblesMessages(rawCursor: BlueBubblesCursor) {
  const cursor = BlueBubblesCursorSchema.parse(rawCursor);
  const config = await imessageIngressConfig();
  if (!config.enabled || config.owners.length === 0) {
    const latestRowId = await initialBlueBubblesRowId();
    return BlueBubblesPollResultSchema.parse({
      startedAt: cursor.startedAt,
      lastRowId: Math.max(cursor.lastRowId, latestRowId),
      commands: [],
    });
  }
  const initializing = cursor.lastRowId === 0;
  if (initializing) {
    return BlueBubblesPollResultSchema.parse({
      startedAt: cursor.startedAt,
      lastRowId: await initialBlueBubblesRowId(),
      commands: [],
    });
  }
  const messages = z
    .array(BlueBubblesMessageSchema)
    .max(BLUEBUBBLES_QUERY_LIMIT)
    .parse(
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
    throw new Error(
      "BlueBubbles backlog exceeds 999 messages; cursor was not advanced",
    );
  const batch = messages
    .toSorted((left, right) => left.originalROWID - right.originalROWID)
    .slice(0, 50);
  if (batch.some((message) => message.originalROWID <= cursor.lastRowId))
    throw new Error("BlueBubbles returned a message outside the cursor query");
  const commands = batch.flatMap((message) => {
    const command = blueBubblesCommand(message, config.owners);
    return command === undefined ? [] : [command];
  });
  return BlueBubblesPollResultSchema.parse({
    startedAt: cursor.startedAt,
    lastRowId: batch.at(-1)?.originalROWID ?? cursor.lastRowId,
    commands,
  });
}
