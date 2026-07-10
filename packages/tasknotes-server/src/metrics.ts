import { Counter, Gauge, Histogram, Registry } from "prom-client";

export const registry = new Registry();

export const httpRequestsTotal = new Counter({
  name: "tasknotes_http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "route", "status"] as const,
  registers: [registry],
});

export const httpRequestDurationSeconds = new Histogram({
  name: "tasknotes_http_request_duration_seconds",
  help: "Duration of HTTP requests in seconds",
  labelNames: ["method", "route"] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  registers: [registry],
});

export const tasksTotal = new Gauge({
  name: "tasknotes_tasks_total",
  help: "Current total number of tasks",
  registers: [registry],
});

export const tasksCreatedTotal = new Counter({
  name: "tasknotes_tasks_created_total",
  help: "Total number of tasks created",
  registers: [registry],
});

export const tasksUpdatedTotal = new Counter({
  name: "tasknotes_tasks_updated_total",
  help: "Total number of tasks updated",
  registers: [registry],
});

export const tasksDeletedTotal = new Counter({
  name: "tasknotes_tasks_deleted_total",
  help: "Total number of tasks deleted",
  registers: [registry],
});

export const syncFilesTotal = new Gauge({
  name: "tasknotes_sync_files_total",
  help: "Number of files in the vault",
  registers: [registry],
});

export const uptimeSeconds = new Gauge({
  name: "tasknotes_uptime_seconds",
  help: "Server uptime in seconds",
  registers: [registry],
});
