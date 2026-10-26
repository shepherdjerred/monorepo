import { registry } from "#src/metrics/registry.ts";
import { Counter, Histogram } from "prom-client";
export const dareMessageOperationDurationSeconds = new Histogram({
  name: "scout_dare_message_operation_duration_seconds",
  help: "Dare message delivery duration.",
  labelNames: ["surface", "operation"] as const,
  registers: [registry],
});
export const dareMessageOperationsTotal = new Counter({
  name: "scout_dare_message_operations_total",
  help: "Dare message delivery outcomes.",
  labelNames: ["surface", "operation", "result"] as const,
  registers: [registry],
});
