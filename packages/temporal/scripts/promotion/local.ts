import { chmod, mkdir, rename } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod/v4";
import { costForTextUsage } from "@shepherdjerred/llm-models";
import { promotionManifest } from "#activities/promotion/manifest.ts";
import {
  PromotionManifestSchema,
  PromotionAttemptSchema,
  promotionStateSummary,
  promotionFailurePause,
} from "#shared/promotion/model.ts";
import {
  readPromotionState,
  updatePromotionState,
} from "#activities/promotion/store.ts";
import { PromotionLoginsSchema } from "#activities/promotion/tools.ts";
import { promotionSecretTokens } from "#activities/promotion/redaction.ts";
import { redactSecrets } from "#shared/redact.ts";
import { localPromotionStore, claimLocalSession } from "./local-store.ts";
import { LocalPromotionSettings } from "./local-execution.ts";
import { runLocalTarget } from "./local-agent.ts";
import { createLocalJournal } from "./local-journal.ts";
import { LocalPromotionStop } from "./local-stop.ts";
import { localCleanup } from "./local-cleanup.ts";

const help = `Local promotion: bun packages/temporal/scripts/promotion/local.ts <status|preview|run|pause|resume|reconcile|cleanup|import-history> [target ...] [--all] [--state-dir PATH] [--json] [--settings FILE] [--history FILE] [--mailmate] [--occurrence ID]
No Temporal server or cluster is used. Preview cannot publish. Run performs real actions.
Cleanup deletes only an exact saved verified DISBOARD reply; supply its --occurrence ID.
History is a JSON array of {targetId, attempt}, using the PromotionAttempt schema.
Real runs require an imported history record for each target. Resume is explicit review of filtered/blocked results and never clears attempts.`;
const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  options: {
    all: { type: "boolean" },
    json: { type: "boolean" },
    help: { type: "boolean" },
    "state-dir": { type: "string" },
    settings: { type: "string" },
    history: { type: "string" },
    mailmate: { type: "boolean" },
    occurrence: { type: "string" },
  },
});
const [operation, ...ids] = positionals;
if (operation === undefined || values.help === true) {
  process.stdout.write(`${help}\n`);
  process.exit(0);
}
if (
  ![
    "status",
    "preview",
    "run",
    "pause",
    "resume",
    "reconcile",
    "import-history",
    "cleanup",
  ].includes(operation)
)
  throw new Error(help);
if (values.all === true && ids.length > 0)
  throw new Error("Choose explicit targets or --all");
const inventory = PromotionManifestSchema.parse(promotionManifest);
const targets =
  values.all === true || (operation === "status" && ids.length === 0)
    ? inventory.targets
    : ids.map((id) => {
        const target = inventory.targets.find(
          (candidate) => candidate.id === id,
        );
        if (target === undefined) throw new Error(`Unknown target: ${id}`);
        return target;
      });
if (operation !== "import-history" && targets.length === 0)
  throw new Error("Select exact targets or --all");
if (new Set(targets.map((target) => target.id)).size !== targets.length)
  throw new Error("Select each target only once");
const directory = path.resolve(
  values["state-dir"] ??
    path.join(homedir(), ".local/state/the-storm/promotion"),
);
const database = await localPromotionStore(directory);
const { store } = database;
const results: unknown[] = [];
let release: (() => Promise<void>) | undefined;
try {
  if (operation === "cleanup") {
    if (targets.length !== 1 || values.occurrence === undefined)
      throw new Error(
        "cleanup requires one target and --occurrence <verified occurrence>",
      );
    release = await claimLocalSession(store);
    const result = await localCleanup({
      store,
      directory,
      targetId: z.string().parse(targets[0]?.id),
      occurrenceId: values.occurrence,
      socket:
        Bun.env["PROMOTION_DISCORD_SOCKET"] ??
        path.join(homedir(), ".toolkit/discord/storm-promotion/daemon.sock"),
    });
    results.push(result);
    if (result.cleanup.status === "blocked") process.exitCode = 1;
  } else if (operation === "import-history") {
    if (values.history === undefined)
      throw new Error("--history FILE is required");
    const rows = z
      .array(
        z.strictObject({
          targetId: z.string(),
          attempt: PromotionAttemptSchema,
        }),
      )
      .min(1)
      .parse(await Bun.file(values.history).json());
    for (const row of rows) {
      if (!inventory.targets.some((target) => target.id === row.targetId))
        throw new Error(`Unknown history target: ${row.targetId}`);
      await updatePromotionState(store, row.targetId, (state) => {
        const old = state.attempts.find(
          (attempt) => attempt.occurrenceId === row.attempt.occurrenceId,
        );
        if (
          old !== undefined &&
          JSON.stringify(old) !== JSON.stringify(row.attempt)
        )
          throw new Error("Conflicting imported receipt");
        if (state.lock !== null)
          throw new Error("Cannot import into an owned target");
        return {
          ...state,
          attempts:
            old === undefined
              ? [...state.attempts, row.attempt]
              : state.attempts,
        };
      });
    }
    results.push({ imported: rows.length });
  } else if (["status", "pause", "resume"].includes(operation)) {
    for (const target of targets) {
      const state =
        operation === "status"
          ? await readPromotionState(store, target.id)
          : await updatePromotionState(store, target.id, (current) => ({
              ...current,
              paused: operation === "pause",
              executionHealth:
                operation === "resume"
                  ? {
                      consecutiveFailures: 0,
                      lastOccurrenceId:
                        current.executionHealth.lastOccurrenceId,
                    }
                  : current.executionHealth,
              blockedReason:
                operation === "resume" &&
                !current.attempts.some(
                  (attempt) => attempt.status === "uncertain",
                )
                  ? null
                  : current.blockedReason,
            }));
      results.push({
        ...promotionStateSummary(state),
        status:
          target.action === "pending"
            ? "blocked"
            : state.paused || promotionFailurePause(state) !== null
              ? "paused"
              : "idle",
        summary:
          target.action === "pending"
            ? target.notes
            : (promotionFailurePause(state) ?? state.blockedReason),
      });
    }
  } else {
    release = await claimLocalSession(store);
    if (Bun.env["OP_SERVICE_ACCOUNT_TOKEN"] !== undefined)
      throw new Error(
        "Remove OP_SERVICE_ACCOUNT_TOKEN after credential injection before starting the runner",
      );
    const settings = LocalPromotionSettings.parse(
      values.settings === undefined
        ? {}
        : await Bun.file(values.settings).json(),
    );
    const logins = PromotionLoginsSchema.parse(
      JSON.parse(z.string().min(1).parse(Bun.env["STORM_PROMOTION_LOGINS"])),
    );
    const secrets = z
      .array(z.string())
      .parse(
        promotionSecretTokens(logins).filter((value) => value !== undefined),
      );
    const redact = (text: string) => redactSecrets(text, secrets);
    const mode = z.enum(["preview", "run", "reconcile"]).parse(operation);
    Bun.env["TEMPORAL_NAMESPACE"] = "dev";
    Bun.env["ENVIRONMENT"] = "development";
    delete Bun.env["AGENT_PROVIDER_UID"];
    if (targets.some((target) => target.discord === undefined)) {
      const browser = z
        .object({
          server: z.object({
            port: z.coerce.number().int().positive(),
            token: z.string().min(1),
          }),
        })
        .parse(
          await Bun.file(
            Bun.env["PINCHTAB_CONFIG"] ??
              path.join(
                homedir(),
                "Library/Application Support/pinchtab/config.json",
              ),
          ).json(),
        );
      Bun.env["PINCHTAB_BASE_URL"] =
        `http://127.0.0.1:${String(browser.server.port)}`;
      Bun.env["PINCHTAB_TOKEN"] = browser.server.token;
    }
    const batchId = crypto.randomUUID();
    const output = path.join(directory, "runs", batchId);
    await mkdir(output, { recursive: true, mode: 0o700 });
    const journal = await createLocalJournal(store, batchId, mode, {
      targetIds: targets.map((target) => target.id),
      scope: values.all === true ? "all" : "selected",
    });
    const saveReport = async () => {
      const temporary = path.join(output, "summary.json.tmp");
      await Bun.write(temporary, redact(JSON.stringify(results, null, 2)));
      await chmod(temporary, 0o600);
      await rename(temporary, path.join(output, "summary.json"));
    };
    for (const target of targets) {
      await journal.update(target.id, {
        effectiveMode: target.action === "inspect" ? "preview" : mode,
        status: "running",
        phase: "Checking prerequisites",
        startedAt: new Date().toISOString(),
      });
      try {
        const outcome = await runLocalTarget({
          target,
          mode,
          store,
          settings,
          output,
          mailmate: values.mailmate === true,
          secrets,
          progress: async (phase, occurrenceId) => {
            await journal.update(target.id, {
              phase,
              ...(occurrenceId === undefined ? {} : { occurrenceId }),
            });
          },
        });
        results.push({
          targetId: target.id,
          ...outcome,
          aiCostUsd: costForTextUsage(settings.model, outcome.usage),
          state: promotionStateSummary(
            await readPromotionState(store, target.id),
          ),
        });
        await journal.update(target.id, {
          status: "completed",
          phase: outcome.result.status,
          summary: outcome.result.summary,
          finishedAt: new Date().toISOString(),
        });
        process.exitCode =
          outcome.result.status === "blocked" ||
          outcome.cleanup?.status === "blocked"
            ? 1
            : process.exitCode;
      } catch (error) {
        const summary = redact(
          error instanceof Error ? error.message : String(error),
        );
        await journal.update(target.id, {
          status: error instanceof LocalPromotionStop ? "skipped" : "failed",
          phase: error instanceof LocalPromotionStop ? error.reason : "Stopped",
          summary,
          finishedAt: new Date().toISOString(),
        });
        results.push({
          targetId: target.id,
          status: "blocked",
          summary: redact(
            error instanceof Error ? error.message : String(error),
          ),
        });
        process.exitCode = 1;
      }
      await saveReport();
    }
    const report = path.join(output, "summary.json");
    await saveReport();
    await journal.finish();
    process.stdout.write(`Results: ${report}\n`);
  }
  if (values.json === true)
    process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
  else
    process.stdout.write(
      results
        .map((result) => {
          const row = z
            .object({
              targetId: z.string().optional(),
              status: z.string().optional(),
              summary: z.string().nullable().optional(),
              paused: z.boolean().optional(),
              nextEligibleAt: z.string().nullable().optional(),
              cleanup: z
                .object({ status: z.string(), summary: z.string().optional() })
                .optional(),
              result: z
                .object({ status: z.string(), summary: z.string() })
                .optional(),
            })
            .parse(result);
          return [
            row.targetId ?? "history",
            row.result?.status ??
              row.status ??
              (row.paused === true ? "paused" : "idle"),
            [
              row.result?.summary ?? row.summary ?? "",
              row.cleanup?.status === "blocked"
                ? `Cleanup blocked: ${row.cleanup.summary ?? "see receipt audit"}`
                : "",
            ]
              .filter(Boolean)
              .join(" "),
            row.nextEligibleAt ?? "",
          ].join("\t");
        })
        .join("\n") + "\n",
    );
} finally {
  try {
    await release?.();
  } finally {
    database.close();
  }
}
