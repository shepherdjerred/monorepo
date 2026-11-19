import { z } from "zod";
import { TautulliHistoryRowSchema } from "#shared/household/playback.ts";
import {
  endpoint,
  IntegrationError,
  json,
  request,
  type FetchTransport,
} from "./http.ts";

const IntegerSchema = z.union([
  z.number().int().nonnegative(),
  z.string().regex(/^\d+$/u).transform(Number),
]);
const HistoricalRowSchema = z.object({
  row_id: IntegerSchema,
  user_id: IntegerSchema,
  rating_key: IntegerSchema,
  started: IntegerSchema,
  stopped: IntegerSchema,
  play_duration: IntegerSchema,
  percent_complete: z.union([
    z.number(),
    z
      .string()
      .regex(/^\d+(?:\.\d+)?$/u)
      .transform(Number),
  ]),
  full_title: z.string(),
  grandparent_title: z.string().nullable().optional(),
  media_type: z.string(),
  platform: z.string(),
  player: z.string(),
  transcode_decision: z.enum(["direct play", "copy", "transcode", ""]),
});
const ResponseSchema = z.object({
  response: z.object({
    result: z.literal("success"),
    data: z.object({
      recordsTotal: IntegerSchema,
      recordsFiltered: IntegerSchema,
      data: z.array(HistoricalRowSchema),
    }),
  }),
});

/** Read-only Tautulli 2.18+ API: the API key stays in an authenticated header. */
export class TautulliPlaybackClient {
  constructor(
    private readonly config: { baseUrl: string; apiKey: string },
    private readonly transport: FetchTransport = fetch,
  ) {}
  async historyPage(
    input: { offset: number; limit: number; through: Date },
    signal?: AbortSignal,
  ) {
    if (
      !Number.isSafeInteger(input.offset) ||
      input.offset < 0 ||
      !Number.isSafeInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 1000 ||
      !Number.isFinite(input.through.getTime())
    )
      throw new Error("Invalid playback history page");
    const url = endpoint(this.config.baseUrl, "api/v2");
    for (const [key, value] of Object.entries({
      cmd: "get_history",
      grouping: "0",
      include_activity: "0",
      order_column: "started",
      order_dir: "asc",
      start: String(input.offset),
      length: String(input.limit),
    }))
      url.searchParams.set(key, value);
    const response = await request(this.transport, "tautulli", url, {
      method: "GET",
      headers: { Accept: "application/json", "X-Api-Key": this.config.apiKey },
      ...(signal === undefined ? {} : { signal }),
    });
    const parsed = ResponseSchema.safeParse(await json(response, "tautulli"));
    if (!parsed.success)
      throw new IntegrationError("tautulli", "invalid-response");
    const page = parsed.data.response.data;
    return {
      total: page.recordsTotal,
      filtered: page.recordsFiltered,
      received: page.data.length,
      rows: page.data
        .filter(
          (row) =>
            row.stopped > 0 && row.stopped * 1000 < input.through.getTime(),
        )
        .map((row) =>
          TautulliHistoryRowSchema.parse({
            id: row.row_id,
            user_id: row.user_id,
            rating_key: row.rating_key,
            started: row.started,
            stopped: row.stopped,
            duration: row.play_duration,
            percent_complete: row.percent_complete,
            full_title: row.full_title,
            grandparent_title: row.grandparent_title ?? null,
            media_type: row.media_type,
            platform: row.platform,
            player: row.player,
            transcode_decision:
              row.transcode_decision === "direct play"
                ? "direct_play"
                : row.transcode_decision === "copy"
                  ? "direct_stream"
                  : row.transcode_decision === "transcode"
                    ? "transcode"
                    : "unknown",
          }),
        ),
    };
  }
}
