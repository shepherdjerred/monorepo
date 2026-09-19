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

export async function pollBlueBubblesMessages(rawCursor: BlueBubblesCursor) {
  const cursor = BlueBubblesCursorSchema.parse(rawCursor);
  const config = await imessageIngressConfig();
  if (!config.enabled || config.owners.length === 0)
    return {
      startedAt: cursor.startedAt,
      lastRowId: cursor.lastRowId,
      commands: [],
    };
  const initializing = cursor.lastRowId === 0;
  const messages = z
    .array(BlueBubblesMessageSchema)
    .max(1000)
    .parse(
      await blueBubblesRequest("/api/v1/message/query", {
        with: ["chats"],
        limit: initializing ? 1 : 1000,
        sort: initializing ? "DESC" : "ASC",
        ...(initializing
          ? {}
          : {
              where: [
                {
                  statement: "message.ROWID > :cursor",
                  args: { cursor: cursor.lastRowId },
                },
              ],
            }),
      }),
    );
  if (initializing) {
    return BlueBubblesPollResultSchema.parse({
      startedAt: cursor.startedAt,
      lastRowId: messages[0]?.originalROWID ?? 0,
      commands: [],
    });
  }
  // The API sorts by message time, not ROWID. A full page cannot safely advance a ROWID cursor.
  if (messages.length === 1000)
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
