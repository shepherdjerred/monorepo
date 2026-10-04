import type { z } from "zod";
import { formatTimecode } from "@shepherdjerred/streambot/util/timecode.ts";
import {
  ErrorSchema,
  type WebCommand,
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
export function elapsed(seconds: number | null): string {
  return seconds === null ? "—" : formatTimecode(seconds);
}
