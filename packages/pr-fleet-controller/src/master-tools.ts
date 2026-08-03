import { createTool } from "@mastra/core/tools";
import { z } from "zod";
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
  stop: () => Promise<FleetSnapshot>;
};

export function createMasterTools(controller: MasterControllerTools) {
  return {
    fleet_status: createTool({
      id: "fleet_status",
      description: "Get the current deterministic fleet snapshot.",
      inputSchema: z.object({}),
      outputSchema: FleetSnapshotSchema,
      execute: () => Promise.resolve(controller.snapshot()),
    }),
    run_fleet_tick: createTool({
      id: "run_fleet_tick",
      description: "Request an immediate complete fleet reconciliation.",
      inputSchema: z.object({}),
      outputSchema: FleetTickReportSchema,
      execute: async () => controller.tick(),
    }),
    prioritize_pr: createTool({
      id: "prioritize_pr",
      description: "Set queue priority for one PR without changing readiness.",
      inputSchema: z.object({
        pr: z.number().int().positive(),
        priority: z.number().int().min(-100).max(100),
      }),
      outputSchema: z.object({ updated: z.boolean() }),
      execute: ({ pr, priority }) => {
        controller.prioritize(pr, priority);
        return Promise.resolve({ updated: true });
      },
    }),
    pause_pr: createTool({
      id: "pause_pr",
      description: "Pause new work and publication for one PR.",
      inputSchema: z.object({
        pr: z.number().int().positive(),
        reason: z.string().min(1),
      }),
      outputSchema: z.object({ paused: z.boolean() }),
      execute: ({ pr, reason }) => {
        controller.pause(pr, reason);
        return Promise.resolve({ paused: true });
      },
    }),
    resume_pr: createTool({
      id: "resume_pr",
      description: "Resume a user-paused PR.",
      inputSchema: z.object({ pr: z.number().int().positive() }),
      outputSchema: z.object({ resumed: z.boolean() }),
      execute: ({ pr }) => {
        controller.resume(pr);
        return Promise.resolve({ resumed: true });
      },
    }),
    send_worker_guidance: createTool({
      id: "send_worker_guidance",
      description: "Queue guidance for a PR's next worker cycle.",
      inputSchema: z.object({
        pr: z.number().int().positive(),
        message: z.string().min(1),
      }),
      outputSchema: z.object({ queued: z.boolean() }),
      execute: ({ pr, message }) => {
        controller.guide(pr, message);
        return Promise.resolve({ queued: true });
      },
    }),
    set_worker_limit: createTool({
      id: "set_worker_limit",
      description: "Set worker concurrency between one and five.",
      inputSchema: z.object({ limit: z.number().int().min(1).max(5) }),
      outputSchema: z.object({ updated: z.boolean() }),
      execute: ({ limit }) => {
        controller.setWorkerLimit(limit);
        return Promise.resolve({ updated: true });
      },
    }),
    stop_controller: createTool({
      id: "stop_controller",
      description: "Safely stop the fleet controller.",
      inputSchema: z.object({}),
      outputSchema: FleetSnapshotSchema,
      execute: async () => controller.stop(),
    }),
  };
}
