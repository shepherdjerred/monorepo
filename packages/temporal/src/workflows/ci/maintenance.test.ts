import { expect, test, vi } from "vitest";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { runWorkflowWithActivityWorker } from "#workflows/test-support.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import type {
  MaintenanceObservation,
  MaintenanceRequest,
} from "#shared/ci-maintenance.ts";

const workflowPath = new URL("../index.ts", import.meta.url).pathname;
test.each(["receipt", "absent"])(
  "replays an ambiguous submission and requires reconciliation (%s)",
  async (recovery) => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    const submitted: MaintenanceRequest[] = [];
    let inspections = 0;
    const observation: MaintenanceObservation = {
      enabled: true,
      busy: false,
      pending: null,
      candidates: [
        {
          kind: "release-notes",
          source: "a".repeat(40),
          fingerprint: "release-1",
          frozen: false,
        },
        {
          kind: "ci-images",
          source: "a".repeat(40),
          fingerprint: "images-1",
          frozen: false,
        },
      ],
    };
    try {
      await runWorkflowWithActivityWorker(environment, {
        workflowPath,
        activityTaskQueue: TASK_QUEUES.REPO_AUTOMATION,
        activities: {
          inspectCiMaintenance: () => {
            inspections++;
            return structuredClone(observation);
          },
          submitCiMaintenance: (request: MaintenanceRequest) => {
            submitted.push(request);
            if (submitted.length === 1)
              throw new Error("Response lost after POST");
            return 42;
          },
        },
        execute: async () => {
          const handle = await environment.client.workflow.start(
            "runCiMaintenanceCoordinator",
            {
              workflowId: `maintenance-${crypto.randomUUID()}`,
              taskQueue: TASK_QUEUES.WORKFLOWS,
            },
          );
          const state = async () => {
            const description = await handle.describe();
            return description.memo?.["ciMaintenance"];
          };
          try {
            await vi.waitFor(
              async () => {
                const snapshot = await state();
                expect(snapshot).toMatchObject({
                  observation: expect.stringContaining("uncertain"),
                });
              },
              { timeout: 20_000 },
            );
            const first = submitted[0];
            if (first === undefined) throw new Error("No recorded submission");
            const before = inspections;
            await Promise.all(
              Array.from({ length: 3 }, () => handle.signal("maintenanceTick")),
            );
            await vi.waitFor(() => expect(inspections).toBeGreaterThan(before));
            expect(submitted).toHaveLength(1);
            const unresolved = await state();
            expect(unresolved).toMatchObject({
              pending: { requestId: first.requestId },
            });
            if (recovery === "absent") {
              await handle.signal("maintenanceConfirmAbsent", {
                requestId: first.requestId,
                evidence:
                  "API audit confirms rejected POST created no pipeline",
              });
            } else {
              observation.pending = {
                number: 41,
                source: first.source,
                status: "failure",
              };
              await handle.signal("maintenanceTick");
            }
            await vi.waitFor(async () => {
              const snapshot = await state();
              expect(snapshot).toMatchObject({
                blocked: { "release-notes": { requestId: first.requestId } },
              });
            });
            observation.pending = null;
            await handle.signal("maintenanceTick");
            await vi.waitFor(() => expect(submitted).toHaveLength(2));
            expect(submitted[1]?.kind).toBe("ci-images");
            observation.pending = {
              number: 42,
              source: first.source,
              status: "success",
              deferred: false,
            };
            await handle.signal("maintenanceTick");
            await vi.waitFor(async () => {
              const snapshot = await state();
              expect(snapshot).toMatchObject({
                completed: { "ci-images": "images-1" },
              });
            });
            observation.pending = null;
            await handle.signal("maintenanceTick");
            await handle.signal("maintenanceRetry", {
              kind: "release-notes",
              requestId: "wrong-request",
            });
            const blocked = await state();
            expect(blocked).toMatchObject({
              blocked: { "release-notes": { requestId: first.requestId } },
            });
            expect(submitted).toHaveLength(2);
            const history = await handle.fetchHistory();
            await Worker.runReplayHistory(
              { workflowsPath: workflowPath },
              history,
            );
          } finally {
            await handle.terminate("Test complete");
          }
        },
      });
    } finally {
      await environment.teardown();
    }
  },
  60_000,
);
