import { z } from "zod";

export const WorkerRoleSchema = z.enum([
  "all",
  "agent",
  "control",
  "core",
  "glitter",
  "glitter-context",
  "glitter-corpus",
  "home",
  "infra",
  "legacy",
  "maintenance",
  "repo",
  "reports",
  "scout",
]);

export type WorkerRole = z.infer<typeof WorkerRoleSchema>;

export function parseWorkerRole(value: string | undefined): WorkerRole {
  return WorkerRoleSchema.parse(value ?? "all");
}

export function workerRoleRunsCore(role: WorkerRole): boolean {
  return role === "all" || role === "core";
}

export function workerRoleRunsAgent(role: WorkerRole): boolean {
  return role === "all" || role === "agent";
}

export function workerRoleRunsGlitter(role: WorkerRole): boolean {
  return role === "all" || role === "glitter";
}

export function workerRoleRunsMaintenance(role: WorkerRole): boolean {
  return role === "all" || role === "maintenance";
}
