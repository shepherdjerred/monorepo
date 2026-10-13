import { afterEach, expect, test, vi } from "vitest";
import { cleanupTrackerAttachments } from "./tracker-attachments.ts";
import { TRACKER_ATTACHMENT_SCHEDULE } from "#schedules/tracker-attachments.ts";

vi.mock("@temporalio/activity", () => ({
  activityInfo: () => ({ workflowExecution: { runId: "native-run" } }),
}));
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("sends an attributed mutation to the private tracker API", async () => {
  let input: unknown;
  globalThis.fetch = Object.assign(
    async (url: string | URL | Request, options?: RequestInit) => {
      expect(url instanceof Request ? url.url : url.toString()).toBe(
        "http://tracker.tracker.svc.cluster.local:7351/trpc/maintenance.cleanupStaged",
      );
      expect(options?.method).toBe("POST");
      const body = options?.body;
      if (typeof body !== "string") throw new TypeError("expected a JSON body");
      input = JSON.parse(body);
      return Response.json({ result: { data: 3 } });
    },
    { preconnect: originalFetch.preconnect },
  );
  await expect(cleanupTrackerAttachments()).resolves.toEqual({
    status: "completed",
    removed: 3,
  });
  expect(input).toMatchObject({
    actor: {
      key: "runner:temporal:native-run",
      kind: "runner",
      metadata: { sessionId: "native-run" },
    },
  });
});

test("treats the intentional write freeze as paused and surfaces server failures", async () => {
  globalThis.fetch = Object.assign(
    async () =>
      Response.json(
        {
          error: {
            message: "Tracker writes are paused",
            code: -32_003,
            data: { code: "FORBIDDEN", httpStatus: 403 },
          },
        },
        { status: 403 },
      ),
    { preconnect: originalFetch.preconnect },
  );
  await expect(cleanupTrackerAttachments()).resolves.toEqual({
    status: "paused",
    removed: 0,
  });
  globalThis.fetch = Object.assign(
    async () => new Response("unavailable", { status: 503 }),
    { preconnect: originalFetch.preconnect },
  );
  await expect(cleanupTrackerAttachments()).rejects.toThrow();
});

test("registers paused with bounded overlapping and catchup behavior", () => {
  expect(TRACKER_ATTACHMENT_SCHEDULE).toMatchObject({
    namespace: "prod",
    timing: { kind: "interval", every: "1 hour" },
    taskQueue: "monorepo-workflows",
    catchupWindow: "1 hour",
  });
  expect(TRACKER_ATTACHMENT_SCHEDULE.initialPauseNote).toContain("100%");
});
