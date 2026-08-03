import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { withCommandCorrelation } from "./command-correlation.ts";
import type { FleetTelemetry } from "./ports.ts";
import type { RunEventCorrelation } from "./run-events.ts";
import {
  FleetSnapshotSchema,
  FleetTickReportSchema,
  type FleetSnapshot,
  type FleetTickReport,
} from "./schemas.ts";

export type MasterControllerTools = {
  snapshot: () => FleetSnapshot;
  tick: () => Promise<FleetTickReport>;
  prioritize: (pr: number, priority: number) => void;
  pause: (pr: number, reason: string) => void;
  resume: (pr: number) => void;
  guide: (pr: number, message: string) => void;
  setWorkerLimit: (limit: number) => void;
};

type MasterToolTelemetry = {
  telemetry: FleetTelemetry;
  correlation: () => RunEventCorrelation;
};

export async function runRecordedMasterTool<T>(
  tool: string,
  input: unknown,
  instrumentation: MasterToolTelemetry | undefined,
  run: () => Promise<T>,
): Promise<T> {
  if (instrumentation === undefined) {
    return run();
  }
  const toolCallId = instrumentation.telemetry.newId("tool");
  const correlation = {
    ...instrumentation.correlation(),
    toolCallId,
  };
  instrumentation.telemetry.record(
    "tool.started",
    { tool, input },
    correlation,
  );
  try {
    const result = await withCommandCorrelation(correlation, run);
    instrumentation.telemetry.record(
      "tool.completed",
      { tool, result },
      correlation,
    );
    return result;
  } catch (error) {
    instrumentation.telemetry.record(
      "tool.failed",
      {
        tool,
        error: error instanceof Error ? error.message : String(error),
      },
      correlation,
    );
    throw error;
  }
}

export function createMasterTools(
  controller: MasterControllerTools,
  instrumentation?: MasterToolTelemetry,
  requestShutdown?: () => void,
) {
  return {
    fleet_status: createTool({
      id: "fleet_status",
      description: "Get the current deterministic fleet snapshot.",
      inputSchema: z.object({}),
      outputSchema: FleetSnapshotSchema,
      execute: (input) =>
        runRecordedMasterTool("fleet_status", input, instrumentation, () =>
          Promise.resolve(controller.snapshot()),
        ),
    }),
    run_fleet_tick: createTool({
      id: "run_fleet_tick",
      description: "Request an immediate complete fleet reconciliation.",
      inputSchema: z.object({}),
      outputSchema: FleetTickReportSchema,
      execute: (input) =>
        runRecordedMasterTool("run_fleet_tick", input, instrumentation, () =>
          controller.tick(),
        ),
    }),
    prioritize_pr: createTool({
      id: "prioritize_pr",
      description: "Set queue priority for one PR without changing readiness.",
      inputSchema: z.object({
        pr: z.number().int().positive(),
        priority: z.number().int().min(-100).max(100),
      }),
      outputSchema: z.object({ updated: z.boolean() }),
      execute: (input) =>
        runRecordedMasterTool("prioritize_pr", input, instrumentation, () => {
          controller.prioritize(input.pr, input.priority);
          return Promise.resolve({ updated: true });
        }),
    }),
    pause_pr: createTool({
      id: "pause_pr",
      description: "Pause new work and publication for one PR.",
      inputSchema: z.object({
        pr: z.number().int().positive(),
        reason: z.string().min(1),
      }),
      outputSchema: z.object({ paused: z.boolean() }),
      execute: (input) =>
        runRecordedMasterTool("pause_pr", input, instrumentation, () => {
          controller.pause(input.pr, input.reason);
          return Promise.resolve({ paused: true });
        }),
    }),
    resume_pr: createTool({
      id: "resume_pr",
      description: "Resume a user-paused PR.",
      inputSchema: z.object({ pr: z.number().int().positive() }),
      outputSchema: z.object({ resumed: z.boolean() }),
      execute: (input) =>
        runRecordedMasterTool("resume_pr", input, instrumentation, () => {
          controller.resume(input.pr);
          return Promise.resolve({ resumed: true });
        }),
    }),
    send_worker_guidance: createTool({
      id: "send_worker_guidance",
      description: "Queue guidance for a PR's next worker cycle.",
      inputSchema: z.object({
        pr: z.number().int().positive(),
        message: z.string().min(1),
      }),
      outputSchema: z.object({ queued: z.boolean() }),
      execute: (input) =>
        runRecordedMasterTool(
          "send_worker_guidance",
          input,
          instrumentation,
          () => {
            controller.guide(input.pr, input.message);
            return Promise.resolve({ queued: true });
          },
        ),
    }),
    set_worker_limit: createTool({
      id: "set_worker_limit",
      description: "Set worker concurrency between one and five.",
      inputSchema: z.object({ limit: z.number().int().min(1).max(5) }),
      outputSchema: z.object({ updated: z.boolean() }),
      execute: (input) =>
        runRecordedMasterTool(
          "set_worker_limit",
          input,
          instrumentation,
          () => {
            controller.setWorkerLimit(input.limit);
            return Promise.resolve({ updated: true });
          },
        ),
    }),
    stop_controller: createTool({
      id: "stop_controller",
      description: "Safely stop the fleet controller.",
      inputSchema: z.object({}),
      outputSchema: FleetSnapshotSchema,
      execute: async (input) => {
        if (requestShutdown === undefined) {
          throw new Error("Master shutdown coordination is unavailable");
        }
        const result = await runRecordedMasterTool(
          "stop_controller",
          input,
          instrumentation,
          () => Promise.resolve(controller.snapshot()),
        );
        // Request coordinated shutdown only after this tool has emitted its
        // terminal event. The coordinator aborts and awaits the enclosing
        // master turn before it permits shutdown.completed.
        requestShutdown();
        return result;
      },
    }),
  };
}
