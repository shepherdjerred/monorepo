import type { z } from "zod";
import { formatTimecode } from "@shepherdjerred/streambot/util/timecode.ts";
import {
  ErrorSchema,
  type WebCommand,
  type WebSnapshot,
} from "@shepherdjerred/streambot/web/shared/contracts.ts";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T>(
  url: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, init);
  const value: unknown = await response.json();
  if (!response.ok)
    throw new ApiError(response.status, ErrorSchema.parse(value).message);
  return schema.parse(value);
}
export function commandRequest(
  command: WebCommand,
  csrfToken: string,
): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
    body: JSON.stringify(command),
  };
}
export type RemoteAction = WebCommand extends infer Command
  ? Command extends WebCommand
    ? Omit<
        Command,
        | "guildId"
        | "channelId"
        | "revision"
        | "playbackChannel"
        | "selectionVersion"
        | "slotRevisions"
      >
    : never
  : never;

export function playerCommandRequest(
  action: RemoteAction,
  guildId: string,
  snapshot: WebSnapshot,
  csrfToken: string,
): RequestInit {
  if (snapshot.channel === null)
    throw new Error("A player command requires a voice channel.");
  return commandRequest(
    {
      ...action,
      guildId,
      channelId: snapshot.channel.id,
      revision: snapshot.revision,
      playbackChannel: snapshot.playbackChannel,
      selectionVersion: snapshot.selectionVersion,
      slotRevisions: Object.fromEntries(
        snapshot.playbackChannels.map((slot) => [
          String(slot.number),
          slot.revision,
        ]),
      ),
    },
    csrfToken,
  );
}
export function elapsed(seconds: number | null): string {
  return seconds === null ? "—" : formatTimecode(seconds);
}
