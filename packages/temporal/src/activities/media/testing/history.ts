import assert from "node:assert/strict";
import type { historyToJSON } from "@temporalio/common/lib/proto-utils.js";
import { z } from "zod";

const PayloadCandidate = z.object({
  metadata: z.object({ encoding: z.unknown() }),
});
const Payload = z.object({
  metadata: z.object({ encoding: z.string() }),
  data: z.string().optional(),
});

/** SDK history proves the actual caller's budgets, not just mock Activity defaults. */
export function assertScopedMovieActivityBudgets(
  history: Parameters<typeof historyToJSON>[0],
) {
  let scheduled = 0;
  const fileMethods = new Set([
    "inspectAndStageMovieV4",
    "promoteMovieFilesV4",
    "installMovieSubtitlesV4",
  ]);
  const quotaMethods = new Set([
    "submitMovieTorrentV4",
    "findMovieSubtitlesV4",
  ]);
  for (const event of history.events ?? []) {
    const activity = event.activityTaskScheduledEventAttributes;
    if (activity === null || activity === undefined) continue;
    const name = activity.activityType?.name;
    assert.ok(
      typeof name === "string",
      "Movie history omitted its Activity identity",
    );
    assert.equal(
      Number(activity.startToCloseTimeout?.seconds?.toString()),
      120,
    );
    assert.equal(
      Number(activity.scheduleToCloseTimeout?.seconds?.toString()),
      180,
    );
    assert.equal(
      Number(activity.scheduleToStartTimeout?.seconds?.toString()),
      30,
    );
    assert.equal(
      activity.retryPolicy?.maximumAttempts,
      quotaMethods.has(name) ? 1 : 2,
    );
    assert.equal(
      activity.taskQueue?.name,
      fileMethods.has(name) ? "media-files" : "media-network",
    );
    if (fileMethods.has(name))
      assert.equal(Number(activity.heartbeatTimeout?.seconds?.toString()), 30);
    scheduled++;
  }
  assert.ok(
    scheduled > 0,
    "Movie history must contain actual scheduled Activities",
  );
}

/** Inspect actual payload bytes; searching protobuf JSON alone cannot detect encoded private inputs. */
export function assertPrivateHistory(
  history: string,
  privateValues: readonly string[],
) {
  const decoded: string[] = [];
  collectPayloads(JSON.parse(history), decoded);
  assert.ok(decoded.length > 0, "History must contain actual JSON payloads");
  for (const payload of decoded)
    for (const value of privateValues)
      assert.ok(
        !payload.includes(value),
        "Workflow payload contains private input",
      );
}

function collectPayloads(value: unknown, decoded: string[]): void {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const child of value) collectPayloads(child, decoded);
    return;
  }
  if (PayloadCandidate.safeParse(value).success) {
    const payload = Payload.parse(value);
    const encoding = Buffer.from(payload.metadata.encoding, "base64").toString(
      "utf8",
    );
    assert.ok(
      encoding === "json/plain" || encoding === "binary/null",
      "History contains an unexpected binary payload",
    );
    if (encoding === "json/plain") {
      assert.ok(
        payload.data !== undefined,
        "JSON history payload bytes are missing",
      );
      decoded.push(
        JSON.stringify(
          JSON.parse(Buffer.from(payload.data, "base64").toString("utf8")),
        ),
      );
    }
  }
  for (const child of Object.values(value)) collectPayloads(child, decoded);
}
