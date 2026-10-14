import { z } from "zod";
import { withoutScoutClientPayloadCredentials } from "@scout-for-lol/data/scout-client/protocol.schema.ts";
import { prisma } from "#src/database/index.ts";
import configuration from "#src/configuration.ts";
import { createS3Client } from "#src/storage/s3-client.ts";
import { computeSha256Digest } from "#src/storage/object-integrity.ts";
import { putImmutableRawJson } from "#src/storage/raw-json.ts";
import { evidenceRecoveryEnabled } from "./admission.ts";
import { RawMatchSchema } from "@scout-for-lol/data";
import { parseResultFromMatch } from "#src/scout-client/canonical/riot-result.ts";
import { projectResultEvidence } from "./result-projection.ts";

/** SDK composition captures JSON before any endpoint-specific validator runs. */
export async function captureRiotResponse(response: {
  url: string;
  payload: unknown;
}): Promise<void> {
  if (!evidenceRecoveryEnabled()) return;
  const url = new URL(response.url);
  const match = /^\/lol\/match\/v5\/matches\/([^/]+)(\/timeline)?$/u.exec(
    url.pathname,
  );
  const source =
    match === null
      ? "riot-api"
      : match[2] === undefined
        ? "match-data"
        : "match-timeline";
  await captureRiotPayload(source, response.payload, {
    endpoint: url.pathname,
    host: url.hostname,
    ...(match?.[1] === undefined
      ? {}
      : { matchId: decodeURIComponent(match[1]) }),
  });
}

/** Capture before normalization. Commit pending archive work before returning the response. */
export async function captureRiotPayload(
  source: string,
  payload: unknown,
  context: Record<string, string | number>,
): Promise<void> {
  if (!evidenceRecoveryEnabled()) return;
  const document = {
    archiveVersion: 1,
    source,
    context,
    payload: withoutScoutClientPayloadCredentials(z.json().parse(payload)),
  };
  await prisma.riotPayloadCapture.create({ data: { source, document } });
}

/** Bounded durable outbox, independent of which artifact processing selects. */
export async function reconcileRawRiotPayloads(
  now = new Date(),
): Promise<number> {
  if (!evidenceRecoveryEnabled()) return 0;
  const rows = await prisma.riotPayloadCapture.findMany({
    where: { archivedAt: null, nextAttemptAt: { lte: now } },
    take: 100,
    orderBy: [{ nextAttemptAt: "asc" }, { capturedAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  const failures: unknown[] = [];
  let count = 0;
  for (let offset = 0; offset < rows.length; offset += 4) {
    const results = await Promise.allSettled(
      rows.slice(offset, offset + 4).map(async ({ id }) => {
        const claim = crypto.randomUUID();
        const leased = await prisma.riotPayloadCapture.updateMany({
          where: { id, archivedAt: null, nextAttemptAt: { lte: now } },
          data: {
            claimId: claim,
            nextAttemptAt: new Date(Date.now() + 60_000),
          },
        });
        if (leased.count === 0) return 0;
        const client = createS3Client();
        try {
          if (configuration.s3BucketName === undefined)
            throw new Error("Raw evidence requires an object-store bucket");
          const row = await prisma.riotPayloadCapture.findUniqueOrThrow({
            where: { id },
          });
          const bytes = new TextEncoder().encode(
            JSON.stringify(orderedJson(z.json().parse(row.document))),
          );
          const digest = computeSha256Digest(bytes);
          const date = row.capturedAt
            .toISOString()
            .slice(0, 10)
            .replaceAll("-", "/");
          const key = `riot/observations/${date}/${id}/${digest}.json`;
          await putImmutableRawJson(
            client,
            configuration.s3BucketName,
            { key, bytes, digest },
            "riot",
          );
          if (row.source === "match-data") {
            const raw = z
              .object({
                payload: RawMatchSchema,
                context: z.object({ matchId: z.string() }),
              })
              .safeParse(row.document);
            const result =
              raw.success &&
              raw.data.context.matchId === raw.data.payload.metadata.matchId
                ? parseResultFromMatch(raw.data.payload, row.id)
                : null;
            if (result !== null)
              await projectResultEvidence(result, row.capturedAt);
          }
          const checkpoint = await prisma.riotPayloadCapture.updateMany({
            where: { id, claimId: claim, archivedAt: null },
            data: {
              archiveKey: key,
              archiveDigest: digest,
              archiveBytes: BigInt(bytes.length),
              archivedAt: new Date(),
              claimId: null,
              lastError: null,
            },
          });
          return checkpoint.count;
        } catch (error) {
          await prisma.riotPayloadCapture.updateMany({
            where: { id, claimId: claim, archivedAt: null },
            data: {
              claimId: null,
              lastError: "Raw archival failed; retry remains pending",
            },
          });
          throw error;
        } finally {
          client.destroy();
        }
      }),
    );
    for (const result of results)
      if (result.status === "fulfilled") count += result.value;
      else failures.push(result.reason);
  }
  if (failures.length > 0)
    throw new AggregateError(failures, "Raw Riot archives remain pending");
  return count;
}

function orderedJson(
  value: z.infer<ReturnType<typeof z.json>>,
): z.infer<ReturnType<typeof z.json>> {
  if (Array.isArray(value)) return value.map((entry) => orderedJson(entry));
  return value !== null && typeof value === "object"
    ? Object.fromEntries(
        Object.entries(value)
          .sort(([left], [right]) => (left < right ? -1 : Number(left > right)))
          .map(([key, entry]) => [key, orderedJson(entry)]),
      )
    : value;
}
