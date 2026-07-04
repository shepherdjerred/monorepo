import "./sentry.ts";
import path from "node:path";
import { Hono } from "hono";

import { config } from "./config.ts";
import { IdempotencyStore } from "./idempotency/store.ts";
import { idempotencyMiddleware } from "./middleware/idempotency.ts";
import { syncFilesTotal, tasksTotal, uptimeSeconds } from "./metrics.ts";
import { authMiddleware } from "./middleware/auth.ts";
import { envelopeMiddleware } from "./middleware/envelope.ts";
import { loggerMiddleware } from "./middleware/logger.ts";
import { metricsMiddleware } from "./middleware/metrics.ts";
import { healthRoutes } from "./routes/health.ts";
import { pomodoroRoutes } from "./routes/pomodoro.ts";
import { PomodoroStore } from "./store/pomodoro-store.ts";
import { loadModelConfig } from "./engine/model-config.ts";
import { TaskRepository } from "./engine/task-repository.ts";
import { watchVault } from "./engine/watcher.ts";
import { legacyRoutes } from "./legacy/routes.ts";
import { v2Routes } from "./v2/routes.ts";

/**
 * P3 server: @tasknotes/model-backed engine serving TWO surfaces —
 * - `/api/*`         the upstream plugin contract (v2; the P5 app target)
 * - `/legacy/api/*`  the old camelCase contract for the P2 app (its
 *                    configurable API URL gains a `/legacy` suffix at the
 *                    P4 rollout; the adapter dies at P6).
 * Pomodoro state is ephemeral and vault-independent; the old store serves
 * both surfaces unchanged.
 */

const app = new Hono();

// Loaded during start(); routes close over the boxes.
const { config: modelConfig, source: configSource } = await loadModelConfig(
  config.vaultPath,
);
const repo = new TaskRepository(config.vaultPath, config.tasksDir, modelConfig);
const pomodoroStore = new PomodoroStore();
// Dot-directory: excluded from vault scans, hidden from Obsidian, but on the
// vault PVC so replay dedup survives pod restarts.
const idempotencyStore = new IdempotencyStore(
  path.join(config.vaultPath, ".tasknotes-server", "idempotency.json"),
);

app.use("*", loggerMiddleware);
app.use("*", metricsMiddleware);
app.use("*", authMiddleware);
app.use("*", envelopeMiddleware);
// After envelope: stored + replayed bodies are pre-envelope, wrapped
// identically on the way out (see middleware/idempotency.ts).
app.use("*", idempotencyMiddleware(idempotencyStore));

app.route("/", healthRoutes);
app.route(
  "/",
  v2Routes({ repo, config: modelConfig, vaultPath: config.vaultPath }),
);
app.route("/", pomodoroRoutes(pomodoroStore));
app.route("/legacy", legacyRoutes({ repo, config: modelConfig }));
app.route("/legacy", pomodoroRoutes(pomodoroStore));

// Engine visibility: parse skips and config provenance, next to /api/health.
app.get("/api/engine-status", (c) =>
  c.json({
    configSource,
    tasks: repo.list().length,
    skippedFiles: repo.skippedFiles(),
  }),
);

const startTime = Date.now();

function updateGauges(): void {
  const total = repo.list().length;
  tasksTotal.set(total);
  syncFilesTotal.set(total);
  uptimeSeconds.set(Math.round((Date.now() - startTime) / 1000));
}

async function start(): Promise<void> {
  // Startup gate: an unreadable vault throws here and kills the pod loudly
  // instead of serving an empty task list.
  await repo.scan();
  await idempotencyStore.init();

  watchVault(config.vaultPath, {
    onChanges: (paths) => {
      void (async () => {
        if (paths.length === 0) {
          await repo.scan();
        } else {
          for (const relPath of paths) {
            await repo.refreshFile(relPath);
          }
        }
        updateGauges();
      })();
    },
    onError: (error) => {
      console.error("[watcher] error:", error);
    },
  });

  updateGauges();
  setInterval(updateGauges, 15_000);
  console.log(`TaskNotes server listening on port ${String(config.port)}`);
  console.log(`Vault path: ${config.vaultPath}`);
  console.log(`Model config source: ${configSource}`);
  const skipped = repo.skippedFiles();
  if (skipped.length > 0) {
    console.error(
      `[startup] ${String(skipped.length)} task-like file(s) failed to parse — see /api/engine-status`,
    );
  }
}

void start();

export default {
  port: config.port,
  fetch: app.fetch,
};
