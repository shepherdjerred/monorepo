import { z } from "zod";
import {
  ExploreConversationIdSchema,
  ExploreRunIdSchema,
} from "@scout-for-lol/data";

export const EXPLORE_RUN_MARKERS_KEY = "scout:explore-run-markers:v1";

const ExploreRunMarkerSchema = z
  .object({
    runId: ExploreRunIdSchema,
    conversationId: ExploreConversationIdSchema,
    questionMessageId: z.uuid(),
    state: z.enum(["running", "completed", "failed"]),
  })
  .strict();

export type ExploreRunMarker = z.infer<typeof ExploreRunMarkerSchema>;

const ExploreRunMarkersSchema = z
  .object({
    version: z.literal(1),
    markers: z.array(ExploreRunMarkerSchema).max(100),
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
  storage.setItem(
    EXPLORE_RUN_MARKERS_KEY,
    JSON.stringify(ExploreRunMarkersSchema.parse({ version: 1, markers })),
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
    existing.state === parsed.state
  ) {
    return markers;
  }
  return [
    ...markers.filter(
      (candidate) => candidate.conversationId !== parsed.conversationId,
    ),
    parsed,
  ];
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
