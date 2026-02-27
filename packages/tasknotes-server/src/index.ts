import { Hono } from "hono";

import { config } from "./config.ts";
import { authMiddleware } from "./middleware/auth.ts";
import { envelopeMiddleware } from "./middleware/envelope.ts";
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

app.use("*", authMiddleware);
app.use("*", envelopeMiddleware);

app.route("/", healthRoutes);
app.route("/", taskRoutes(taskStore));
app.route("/", nlpRoutes(taskStore));
app.route("/", timeRoutes(timeStore));
app.route("/", pomodoroRoutes(pomodoroStore));
app.route("/", calendarRoutes(taskStore));

async function start(): Promise<void> {
  await taskStore.init();
  await timeStore.init();
  taskStore.startWatching();
  console.log(`TaskNotes server listening on port ${String(config.port)}`);
  console.log(`Vault path: ${config.vaultPath}`);
}

void start();

export default {
  port: config.port,
  fetch: app.fetch,
};
