import {
  PublicReplayAvailabilitySchema,
  PublicReplayDescriptorSchema,
  type PublicReplayAvailability,
  type PublicReplayDescriptor,
} from "@scout-for-lol/domain/artifacts/public-replay.ts";
import { PublicReplayTimelineResponseSchema } from "@scout-for-lol/domain/artifacts/public-replay-timeline.ts";

export class PublicReplayHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "PublicReplayHttpError";
  }
}

async function readPublicJson(
  url: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const response = await fetch(url, {
    credentials: "omit",
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) {
    throw new PublicReplayHttpError(
      response.status,
      response.status === 404
        ? "This replay is not available."
        : "Scout could not load this replay. Please try again.",
    );
  }
  return response.json();
}

export function replayPath(replayId: string): string {
  return `/replays/${encodeURIComponent(replayId)}`;
}

export function replayContentPath(replayId: string): string {
  return `/api/replays/${encodeURIComponent(replayId)}/content`;
}

export async function fetchPublicReplay(
  replayId: string,
  signal?: AbortSignal,
): Promise<PublicReplayDescriptor> {
  return PublicReplayDescriptorSchema.parse(
    await readPublicJson(
      `/api/replays/${encodeURIComponent(replayId)}`,
      signal,
    ),
  );
}

export async function fetchPublicReplayTimeline(
  replayId: string,
  signal?: AbortSignal,
) {
  return PublicReplayTimelineResponseSchema.parse(
    await readPublicJson(
      `/api/replays/${encodeURIComponent(replayId)}/timeline`,
      signal,
    ),
  );
}

export function qualifiedReplayMatch(matchId: string): {
  platformId: string;
  gameId: string;
} | null {
  const match = /^([a-z]{2,4}\d{0,2})_(\d{1,32})$/i.exec(matchId);
  return match?.[1] === undefined || match[2] === undefined
    ? null
    : { platformId: match[1].toUpperCase(), gameId: match[2] };
}

export async function fetchMatchReplay(
  matchId: string,
  signal?: AbortSignal,
): Promise<PublicReplayAvailability> {
  const match = qualifiedReplayMatch(matchId);
  if (match === null) return { replay: null };
  const query = new URLSearchParams(match);
  return PublicReplayAvailabilitySchema.parse(
    await readPublicJson(`/api/replays?${query.toString()}`, signal),
  );
}

export function publicReplayQuery(replayId: string) {
  return {
    queryKey: ["public-replay", replayId],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchPublicReplay(replayId, signal),
    staleTime: 0,
    retry: (failures: number, error: Error) =>
      !(error instanceof PublicReplayHttpError && error.status < 500) &&
      failures < 1,
  };
}

export function publicReplayTimelineQuery(replayId: string, enabled: boolean) {
  return {
    queryKey: ["public-replay-timeline", replayId],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchPublicReplayTimeline(replayId, signal),
    enabled,
    retry: false,
  };
}

export function matchReplayQuery(matchId: string) {
  return {
    queryKey: ["match-replay", matchId],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchMatchReplay(matchId, signal),
    enabled: qualifiedReplayMatch(matchId) !== null,
    retry: false,
  };
}
