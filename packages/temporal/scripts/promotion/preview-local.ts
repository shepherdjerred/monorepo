import { chmod, mkdtemp } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { MockActivityEnvironment } from "@temporalio/testing";
import { z } from "zod/v4";
import { runPromotionAgent } from "#activities/promotion/agent.ts";
import { promotionTarget } from "#activities/promotion/manifest.ts";
import { promotionSecretTokens } from "#activities/promotion/redaction.ts";
import { memoryPromotionStore } from "#activities/promotion/test-support.ts";
import {
  readPromotionState,
  updatePromotionState,
} from "#activities/promotion/store.ts";
import { PromotionLoginsSchema } from "#activities/promotion/tools.ts";
import { promotionStateSummary } from "#shared/promotion.ts";
import { redactSecrets } from "#shared/redact.ts";

function print(text: string): void {
  process.stdout.write(`${text}\n`);
}

const targets = Bun.argv.slice(2).map((id) => promotionTarget(id));
if (targets.length === 0)
  throw new Error(
    "Usage: bun packages/temporal/scripts/promotion/preview-local.ts <target> [target...]",
  );
if (Bun.env["OP_SERVICE_ACCOUNT_TOKEN"] !== undefined)
  throw new Error(
    "Start with env -u OP_SERVICE_ACCOUNT_TOKEN after credential injection",
  );
const configPath =
  Bun.env["PINCHTAB_CONFIG"] ??
  path.join(homedir(), "Library/Application Support/pinchtab/config.json");
const browser = z
  .object({
    server: z.object({
      port: z.coerce.number().int().min(1).max(65_535),
      token: z.string().min(1),
    }),
  })
  .parse(await Bun.file(configPath).json());
Bun.env["TEMPORAL_NAMESPACE"] = "dev";
Bun.env["ENVIRONMENT"] = "development";
Bun.env["PINCHTAB_BASE_URL"] =
  `http://127.0.0.1:${String(browser.server.port)}`;
Bun.env["PINCHTAB_TOKEN"] = browser.server.token;
delete Bun.env["AGENT_PROVIDER_UID"];
const logins = PromotionLoginsSchema.parse(
  JSON.parse(z.string().min(1).parse(Bun.env["STORM_PROMOTION_LOGINS"])),
);
const tokens = promotionSecretTokens(logins);
const output = await mkdtemp(path.join(tmpdir(), "storm-promotion-preview-"));
await chmod(output, 0o700);
const results: unknown[] = [];
print(
  JSON.stringify({
    mode: "local-preview",
    output,
    temporalServer: false,
    publishing: false,
    paidSolver: false,
  }),
);

for (const target of targets) {
  const store = memoryPromotionStore(),
    runId = crypto.randomUUID();
  const occurrenceId = `storm-promotion/${target.id}/${runId}`;
  const startedAt = new Date().toISOString();
  const state = await updatePromotionState(store, target.id, (current) => ({
    ...current,
    lock: { occurrenceId, acquiredAt: startedAt },
    lastOccurrenceId: occurrenceId,
  }));
  const environment = new MockActivityEnvironment({
    workflowNamespace: "dev",
    workflowExecution: { workflowId: `storm-promotion/${target.id}`, runId },
  });
  let lastProgress = 0;
  environment.on("heartbeat", () => {
    if (Date.now() - lastProgress < 30_000) return;
    lastProgress = Date.now();
    print(
      JSON.stringify({
        targetId: target.id,
        phase: "inspecting",
        elapsedSeconds: Math.floor((Date.now() - Date.parse(startedAt)) / 1000),
      }),
    );
  });
  let outcome: unknown;
  try {
    outcome = await environment.run(() =>
      runPromotionAgent({
        target,
        state,
        occurrenceId,
        mode: "preview",
        store,
      }),
    );
  } catch (error: unknown) {
    outcome = {
      error: redactSecrets(
        error instanceof Error ? error.message : String(error),
        tokens,
      ),
    };
    process.exitCode = 1;
  }
  const final = await readPromotionState(store, target.id);
  if (final.attempts.length > 0)
    throw new Error("Preview unexpectedly recorded a promotion effect");
  const entry = {
    targetId: target.id,
    startedAt,
    completedAt: new Date().toISOString(),
    outcome,
    state: promotionStateSummary(final),
    submissionAttempts: 0,
    paidSolverTasks: 0,
  };
  const serialized = redactSecrets(JSON.stringify(entry, null, 2), tokens);
  const file = path.join(output, `${target.id}.json`);
  await Bun.write(file, serialized);
  await chmod(file, 0o600);
  results.push(JSON.parse(serialized));
  print(
    JSON.stringify({
      targetId: target.id,
      result: file,
      submissionAttempts: 0,
      paidSolverTasks: 0,
    }),
  );
}
const summaryPath = path.join(output, "summary.json");
await Bun.write(
  summaryPath,
  JSON.stringify({ mode: "local-preview", results }, null, 2),
);
await chmod(summaryPath, 0o600);
print(JSON.stringify({ complete: true, result: summaryPath }));
