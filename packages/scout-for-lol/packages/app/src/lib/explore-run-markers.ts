import { z } from "zod";
import {
  ExploreConversationIdSchema,
  ExploreRunIdSchema,
  type ExploreActiveRun,
} from "@scout-for-lol/data";

export const EXPLORE_RUN_MARKERS_KEY = "scout:explore-run-markers:v1";
const MAX_EXPLORE_RUN_MARKERS = 100;

const ExploreRunMarkerSchema = z
  .object({
    runId: ExploreRunIdSchema,
    conversationId: ExploreConversationIdSchema,
    questionMessageId: z.uuid(),
    leafIdAtStart: z.uuid().nullable(),
    state: z.enum(["running", "completed", "failed"]),
  })
  .strict();

export type ExploreRunMarker = z.infer<typeof ExploreRunMarkerSchema>;

export function createExploreRunMarker(
  summary: Pick<
    ExploreActiveRun,
    "runId" | "conversationId" | "questionMessageId" | "leafIdAtStart"
  >,
  state: ExploreRunMarker["state"],
): ExploreRunMarker {
  return ExploreRunMarkerSchema.parse({
    runId: summary.runId,
    conversationId: summary.conversationId,
    questionMessageId: summary.questionMessageId,
    leafIdAtStart: summary.leafIdAtStart,
    state,
  });
}

const ExploreRunMarkersSchema = z
  .object({
    version: z.literal(1),
    markers: z.array(ExploreRunMarkerSchema).max(MAX_EXPLORE_RUN_MARKERS),
  })
  .strict();

export function loadExploreRunMarkers(storage: Storage): ExploreRunMarker[] {
  const stored = storage.getItem(EXPLORE_RUN_MARKERS_KEY);
  if (stored === null) return [];
  try {
    const raw: unknown = JSON.parse(stored);
    const parsed = ExploreRunMarkersSchema.safeParse(raw);
    return parsed.success ? parsed.data.markers : [];
  } catch {
    return [];
  }
}

export function saveExploreRunMarkers(
  storage: Storage,
  markers: ExploreRunMarker[],
): void {
  const retained = retainExploreRunMarkers(markers);
  storage.setItem(
    EXPLORE_RUN_MARKERS_KEY,
    JSON.stringify(
      ExploreRunMarkersSchema.parse({ version: 1, markers: retained }),
    ),
  );
}

export function setExploreRunMarker(
  markers: ExploreRunMarker[],
  marker: ExploreRunMarker,
): ExploreRunMarker[] {
  const parsed = ExploreRunMarkerSchema.parse(marker);
  const existing = markers.find(
    (candidate) => candidate.conversationId === parsed.conversationId,
  );
  if (
    existing?.runId === parsed.runId &&
    existing.questionMessageId === parsed.questionMessageId &&
    existing.leafIdAtStart === parsed.leafIdAtStart &&
    existing.state === parsed.state
  ) {
    return markers;
  }
  return retainExploreRunMarkers([
    ...markers.filter(
      (candidate) => candidate.conversationId !== parsed.conversationId,
    ),
    parsed,
  ]);
}

/** Drop the oldest settled markers before any marker still believed active. */
function retainExploreRunMarkers(
  markers: ExploreRunMarker[],
): ExploreRunMarker[] {
  let toRemove = Math.max(0, markers.length - MAX_EXPLORE_RUN_MARKERS);
  const retained = markers.filter((marker) => {
    if (toRemove > 0 && marker.state !== "running") {
      toRemove -= 1;
      return false;
    }
    return true;
  });
  // More than 100 live markers violates the backend's five-run cap, but stale
  // local state must still remain writable while active-run discovery repairs
  // it. Keep the newest entries and always retain the marker just appended.
  return retained.slice(-MAX_EXPLORE_RUN_MARKERS);
}

export function clearSettledExploreRunMarker(
  markers: ExploreRunMarker[],
  conversationId: string,
): ExploreRunMarker[] {
  return markers.filter(
    (marker) =>
      marker.conversationId !== conversationId || marker.state === "running",
  );
}
