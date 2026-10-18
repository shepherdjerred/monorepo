import { expect } from "vitest";
import type { WorkflowHandle } from "@temporalio/client";
import { Worker } from "@temporalio/worker";
import { z } from "zod";

/**
 * How a test proves a retired Workflow patch gate is still replay-safe.
 *
 * A retired gate becomes `deprecatePatch` at the exact call site. Retained
 * histories carry the marker the gated release recorded, not deprecated, and
 * core refuses a non-deprecated marker no command claims. So a recorded run
 * that replays both as recorded and with its markers rewritten to the gated
 * release's form proves the `deprecatePatch` still claims each marker at the
 * command where the gate stood.
 */

export type RecordedHistory = Awaited<
  ReturnType<WorkflowHandle["fetchHistory"]>
>;

/** The marker name the TypeScript SDK records patch calls under. */
const PATCH_MARKER = "core_patch";

const PatchMarkerDataSchema = z.strictObject({
  id: z.string(),
  deprecated: z.boolean(),
});

/**
 * Visit every patch marker in a history, in event order, with a setter that
 * rewrites that marker's recorded data.
 */
function visitPatchMarkers(
  history: RecordedHistory,
  visit: (
    data: z.infer<typeof PatchMarkerDataSchema>,
    rewrite: (data: z.infer<typeof PatchMarkerDataSchema>) => void,
  ) => void,
): void {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  for (const event of history.events ?? []) {
    const marker = event.markerRecordedEventAttributes;
    if (marker?.markerName !== PATCH_MARKER) continue;
    for (const payloads of Object.values(marker.details ?? {})) {
      for (const payload of payloads.payloads ?? []) {
        visit(
          PatchMarkerDataSchema.parse(
            JSON.parse(decoder.decode(payload.data ?? new Uint8Array())),
          ),
          (data) => {
            payload.data = encoder.encode(JSON.stringify(data));
          },
        );
      }
    }
  }
}

/** The deprecation flag each named patch's markers were recorded with. */
export function recordedPatchMarkers(
  history: RecordedHistory,
  patchIds: readonly string[],
): Record<string, boolean[]> {
  const recorded: Record<string, boolean[]> = {};
  visitPatchMarkers(history, (data) => {
    if (patchIds.includes(data.id)) {
      (recorded[data.id] ??= []).push(data.deprecated);
    }
  });
  return recorded;
}

/**
 * Rewrite the named patches' markers in place as the gated release recorded
 * them, and return the deprecation flag each was recorded with, by patch id.
 */
export function asRecordedByGatedRelease(
  history: RecordedHistory,
  patchIds: readonly string[],
): Record<string, boolean[]> {
  const recorded = recordedPatchMarkers(history, patchIds);
  visitPatchMarkers(history, (data, rewrite) => {
    if (patchIds.includes(data.id)) rewrite({ id: data.id, deprecated: false });
  });
  return recorded;
}

/**
 * Each retired gate records its marker once, deprecated, and the history
 * replays both as recorded and as the gated release recorded it.
 */
export async function expectRetiredGatesReplay(
  history: RecordedHistory,
  patchIds: readonly string[],
  workflowId?: string,
): Promise<void> {
  const workflowsPath = new URL("index.ts", import.meta.url).pathname;
  await Worker.runReplayHistory({ workflowsPath }, history, workflowId);
  const gated = structuredClone(history);
  expect(asRecordedByGatedRelease(gated, patchIds)).toEqual(
    Object.fromEntries(patchIds.map((patchId) => [patchId, [true]])),
  );
  await Worker.runReplayHistory({ workflowsPath }, gated, workflowId);
}
