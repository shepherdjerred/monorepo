export type JobPriority = "critical" | "high" | "normal" | "low";

export type JobStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "awaiting_approval";

export const PRIORITY_MAP: Record<JobPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};
