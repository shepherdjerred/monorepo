import "./sentry.ts";
import { Hono } from "hono";

import { config } from "./config.ts";
import {
  syncFilesTotal,
  tasksCreatedTotal,
  tasksDeletedTotal,
  tasksTotal,
  tasksUpdatedTotal,
  uptimeSeconds,
} from "./metrics.ts";
import { authMiddleware } from "./middleware/auth.ts";
import { envelopeMiddleware } from "./middleware/envelope.ts";
import { loggerMiddleware } from "./middleware/logger.ts";
import { metricsMiddleware } from "./middleware/metrics.ts";
import { calendarRoutes } from "./routes/calendar.ts";
import { healthRoutes } from "./routes/health.ts";
import { nlpRoutes } from "./routes/nlp.ts";
import { pomodoroRoutes } from "./routes/pomodoro.ts";
import { taskRoutes } from "./routes/tasks.ts";
import { timeRoutes } from "./routes/time.ts";
import { PomodoroStore } from "./store/pomodoro-store.ts";
import { TaskStore } from "./store/task-store.ts";
import { TimeStore } from "./store/time-store.ts";

const app = new Hono();

const taskStore = new TaskStore(config.vaultPath, config.tasksDir);
const timeStore = new TimeStore(config.vaultPath);
const pomodoroStore = new PomodoroStore();

app.use("*", loggerMiddleware);
app.use("*", metricsMiddleware);
app.use("*", authMiddleware);
app.use("*", envelopeMiddleware);

app.route("/", healthRoutes);
app.route("/", taskRoutes(taskStore));
app.route("/", nlpRoutes(taskStore));
app.route("/", timeRoutes(timeStore));
app.route("/", pomodoroRoutes(pomodoroStore));
app.route("/", calendarRoutes(taskStore));

const startTime = Date.now();

function updateGauges(): void {
  const stats = taskStore.getStats();
  tasksTotal.set(stats.total);
  syncFilesTotal.set(stats.total);
  uptimeSeconds.set(Math.round((Date.now() - startTime) / 1000));
}

// Instrument task store operations
const originalCreate = taskStore.create.bind(taskStore);
taskStore.create = async (...args) => {
  const result = await originalCreate(...args);
  tasksCreatedTotal.inc();
  updateGauges();
  return result;
};

const originalUpdate = taskStore.update.bind(taskStore);
taskStore.update = async (...args) => {
  const result = await originalUpdate(...args);
  if (result !== undefined) {
    tasksUpdatedTotal.inc();
  }
  return result;
};

const originalDelete = taskStore.delete.bind(taskStore);
taskStore.delete = async (...args) => {
  const result = await originalDelete(...args);
  if (result) {
    tasksDeletedTotal.inc();
    updateGauges();
  }
  return result;
};

async function start(): Promise<void> {
  await taskStore.init();
  await timeStore.init();
  taskStore.startWatching();
  updateGauges();
  setInterval(updateGauges, 15_000);
  console.log(`TaskNotes server listening on port ${String(config.port)}`);
  console.log(`Vault path: ${config.vaultPath}`);
}

void start();

export default {
  port: config.port,
  fetch: app.fetch,
};
