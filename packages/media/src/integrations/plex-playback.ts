import { z } from "zod";
import {
  endpoint,
  IntegrationError,
  json,
  request,
  type FetchTransport,
} from "./http.ts";
import { PlaybackStateSchema } from "#shared/household/playback.ts";

const IdSchema = z
  .union([z.string().min(1), z.number().int().nonnegative()])
  .transform(String);
const SessionSchema = z.object({
  ratingKey: IdSchema,
  sessionKey: IdSchema,
  title: z.string().min(1),
  type: z.string().min(1),
  grandparentTitle: z.string().optional(),
  duration: z.number().int().nonnegative().optional(),
  viewOffset: z.number().int().nonnegative().optional(),
  User: z.object({ id: IdSchema }),
  Player: z.object({
    machineIdentifier: z.string().min(1),
    platform: z.string(),
    state: PlaybackStateSchema,
  }),
  Session: z.object({ id: z.string().min(1) }),
  Media: z
    .array(
      z.object({
        videoDecision: z.string().optional(),
        audioDecision: z.string().optional(),
        Part: z.array(z.object({ decision: z.string().optional() })).optional(),
      }),
    )
    .optional(),
  TranscodeSession: z
    .object({
      videoDecision: z.string().optional(),
      audioDecision: z.string().optional(),
    })
    .optional(),
});
const ContainerSchema = z.object({
  MediaContainer: z.object({
    size: z.number().int().nonnegative(),
    Metadata: z.array(SessionSchema).default([]),
  }),
});
export type PlexPlaybackSession = {
  sessionId: string;
  serverAccountId: string;
  ratingKey: string;
  title: string;
  seriesTitle: string | null;
  mediaType: string;
  platform: string;
  playerId: string;
  state: "playing" | "paused" | "buffering" | "stopped";
  durationMs: number;
  progressMs: number;
  decision: "direct_play" | "direct_stream" | "transcode" | "unknown";
};

/** Dedicated schema: playback metadata must never enter immutable file-serving evidence. */
export class PlexPlaybackClient {
  constructor(
    private readonly config: {
      baseUrl: string;
      token: string;
      clientIdentifier: string;
    },
    private readonly transport: FetchTransport = fetch,
  ) {}
  async sessions(signal?: AbortSignal): Promise<PlexPlaybackSession[]> {
    const response = await request(
      this.transport,
      "plex-playback",
      endpoint(this.config.baseUrl, "status/sessions"),
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          "X-Plex-Token": this.config.token,
          "X-Plex-Client-Identifier": this.config.clientIdentifier,
        },
        ...(signal === undefined ? {} : { signal }),
      },
    );
    const parsed = ContainerSchema.safeParse(
      await json(response, "plex-playback"),
    );
    if (
      !parsed.success ||
      parsed.data.MediaContainer.size !==
        parsed.data.MediaContainer.Metadata.length
    )
      throw new IntegrationError("plex-playback", "invalid-response");
    return parsed.data.MediaContainer.Metadata.map((item) => {
      const decisions = new Set([
        item.TranscodeSession?.videoDecision,
        item.TranscodeSession?.audioDecision,
        ...(item.Media ?? []).flatMap((media) => [
          media.videoDecision,
          media.audioDecision,
          ...(media.Part ?? []).map((part) => part.decision),
        ]),
      ]);
      const decision = decisions.has("transcode")
        ? "transcode"
        : decisions.has("copy")
          ? "direct_stream"
          : decisions.has("directplay") || decisions.has("direct_play")
            ? "direct_play"
            : "unknown";
      return {
        sessionId: item.Session.id,
        serverAccountId: item.User.id,
        ratingKey: item.ratingKey,
        title: item.title,
        seriesTitle: item.grandparentTitle ?? null,
        mediaType: item.type,
        platform: item.Player.platform,
        playerId: item.Player.machineIdentifier,
        state: item.Player.state,
        durationMs: item.duration ?? 0,
        progressMs: item.viewOffset ?? 0,
        decision,
      };
    });
  }
}
