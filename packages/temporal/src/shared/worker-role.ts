import { z } from "zod";

export const WorkerRoleSchema = z.enum([
  "all",
  "core",
  "glitter",
  "maintenance",
]);

export type WorkerRole = z.infer<typeof WorkerRoleSchema>;

export function parseWorkerRole(value: string | undefined): WorkerRole {
  return WorkerRoleSchema.parse(value ?? "all");
}

export function workerRoleRunsCore(role: WorkerRole): boolean {
  return role === "all" || role === "core";
}

export function workerRoleRunsGlitter(role: WorkerRole): boolean {
  return role === "all" || role === "glitter";
}

export function workerRoleRunsMaintenance(role: WorkerRole): boolean {
  return role === "all" || role === "maintenance";
}
