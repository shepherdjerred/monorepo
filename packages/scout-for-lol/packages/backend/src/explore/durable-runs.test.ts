import { describe, expect, test } from "vitest";
import { ReportAiPreviewSummarySchema } from "@scout-for-lol/data";
import { exploreAttachEventsFromRow } from "#src/explore/durable-runs.ts";

const SUMMARY = {
  runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  conversationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  questionMessageId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  leafIdAtStart: null,
  versionCountAtStart: 0,
  startedAt: "2026-09-04T12:00:00.000Z",
};

function row(overrides: Record<string, unknown> = {}) {
  return {
    state: "RUNNING",
    payload: JSON.stringify({ summary: SUMMARY }),
    partialOutput: "Jinx",
    trace: null,
    activity: null,
    preview: null,
    ...overrides,
  };
}

/**
 * A client's SSE request does not necessarily reach the process that owns its
 * run, so this path has to reconstruct progress from the row the Activity's
 * heartbeat mirrors onto. Every field it cannot read is one it has to invent,
 * and inventing them is what made the same run narrate itself differently
 * depending on which subscribe path a request happened to land on.
 */
describe("explore durable snapshot", () => {
  test("uses the mirrored status rather than a fabricated one", () => {
    const [snapshot] = exploreAttachEventsFromRow(
      row({ activity: "Scanned 1.3M rows, kept 84" }),
    );
    if (snapshot?.type !== "snapshot") throw new Error("expected a snapshot");
    expect(snapshot.activity).toBe("Scanned 1.3M rows, kept 84");
  });

  test("restores a mirrored query result", () => {
    const preview = ReportAiPreviewSummarySchema.parse({
      columns: [{ key: "label", label: "Champion", format: "text" }],
      rows: [{ label: "Jinx", values: [] }],
      rowsReturned: 1,
      rowsScanned: 1284,
      renderKind: "TABLE",
    });
    const [snapshot, restored] = exploreAttachEventsFromRow(
      row({ preview: JSON.stringify(preview) }),
    );
    // Beside the snapshot, never inside it — a bundle that predates the
    // companion skips it instead of failing on an unparseable snapshot.
    expect(snapshot?.type).toBe("snapshot");
    if (restored?.type !== "run_preview") {
      throw new Error("expected the preview to follow");
    }
    expect(restored.preview?.rowsScanned).toBe(1284);
    expect(restored.ignorable).toBe(true);
  });

  test("falls back for a run that has not heartbeated yet", () => {
    // Not the old behaviour returning: this covers the window before the
    // first heartbeat, and rows written before these columns existed.
    const [pending] = exploreAttachEventsFromRow(
      row({ state: "PENDING", partialOutput: null }),
    );
    if (pending?.type !== "snapshot") throw new Error("expected a snapshot");
    expect(pending.activity).toBe("Waiting to start…");
    expect(pending.answer).toBeNull();

    const running = exploreAttachEventsFromRow(row());
    expect(running).toHaveLength(1);
    if (running[0]?.type !== "snapshot") {
      throw new Error("expected a snapshot");
    }
    expect(running[0].activity).toBe("Thinking…");
  });
});
