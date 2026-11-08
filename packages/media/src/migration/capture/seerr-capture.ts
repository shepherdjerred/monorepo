import { z } from "zod";
import {
  MAX_MIGRATION_RECORDS,
  MigrationRecordSchema,
  MigrationSnapshotSchema,
  type MigrationRecord,
} from "#shared/migration.ts";
import { CaptureReader, CaptureReadError } from "./capture-http.ts";
import {
  finishCapture,
  failureReason,
  type CapturePass,
} from "./capture-passes.ts";

const RequestWire = z.object({
  id: z.number().int().positive(),
  type: z.enum(["movie", "tv"]),
  status: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
  ]),
  requestedBy: z.object({ id: z.number().int().positive() }),
  media: z.object({
    tmdbId: z.number().int().positive(),
    tvdbId: z.number().int().positive().nullish(),
  }),
  seasons: z
    .array(
      z.object({
        seasonNumber: z.number().int().nonnegative(),
        status: z.number().int().min(1).max(5),
      }),
    )
    .max(1000),
});
const Page = z.object({
  pageInfo: z.object({
    results: z.number().int().nonnegative(),
    page: z.number().int().positive(),
  }),
  results: z.array(RequestWire).max(100),
});
type Source = {
  source: "overseerr" | "jellyseerr" | "seerr";
  sourceInstanceId: string;
  baseUrl: string;
  apiKey: string;
};
function requestRecord(request: z.infer<typeof RequestWire>) {
  return MigrationRecordSchema.parse({
    kind: "request",
    sourceId: String(request.id),
    requesterSourceId: String(request.requestedBy.id),
    plexAccountId: null,
    requesterMappingEvidenceHash: null,
    externalIds: {
      tmdb: request.media.tmdbId,
      ...(request.media.tvdbId == null ? {} : { tvdb: request.media.tvdbId }),
    },
    scope: request.type === "movie" ? "movie" : "season",
    seasons: request.seasons
      .filter((season) => season.status !== 3)
      .map((season) => season.seasonNumber)
      .sort((a, b) => a - b),
    active: request.status !== 3,
  });
}
async function requests(reader: CaptureReader, records: MigrationRecord[]) {
  const actor = await reader.read(
    "api/v1/auth/me",
    z.object({ permissions: z.number().int().nonnegative() }),
  );
  // ADMIN or MANAGE_REQUESTS can see every request on both supported generations.
  if ((actor.permissions & 18) === 0) throw new CaptureReadError("read_failed");
  let total: number | undefined;
  for (let skip = 0; total === undefined || skip < total; skip += 100) {
    const page = await reader.read(
      `api/v1/request?take=100&skip=${String(skip)}&sort=added`,
      Page,
    );
    if (page.pageInfo.results > MAX_MIGRATION_RECORDS)
      throw new CaptureReadError("record_limit");
    if (total !== undefined && total !== page.pageInfo.results)
      throw new CaptureReadError("read_failed");
    total = page.pageInfo.results;
    if (
      page.pageInfo.page !== skip / 100 + 1 ||
      page.results.length !== Math.min(100, total - skip)
    )
      throw new CaptureReadError("read_failed");
    for (const request of page.results) records.push(requestRecord(request));
  }
}
async function pass(
  source: Source,
  fetcher: typeof fetch,
): Promise<CapturePass> {
  const reader = new CaptureReader(source, fetcher);
  const records: MigrationRecord[] = [];
  let version = "unknown";
  try {
    const status = await reader.read(
      "api/v1/status",
      z.object({ version: MigrationSnapshotSchema.shape.sourceVersion }),
    );
    version = status.version;
    await requests(reader, records);
    return { records, version, pages: reader.pages, reason: "complete" };
  } catch (error) {
    return {
      records,
      version,
      pages: reader.pages,
      reason: failureReason(error),
    };
  }
}
/** GET-only paginated request capture. Requester identity always requires a separate owner-reviewed mapping. */
export async function captureSeerr(
  source: Source,
  fetcher: typeof fetch = fetch,
) {
  const startedAt = new Date().toISOString();
  const first = await pass(source, fetcher);
  const second = await pass(source, fetcher);
  return finishCapture({
    sourceKind: source.source,
    sourceInstanceId: source.sourceInstanceId,
    startedAt,
    first,
    second,
    endpoints: ["requests"],
  });
}
