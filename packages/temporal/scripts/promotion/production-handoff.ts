import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
import { realpath } from "node:fs/promises";
import { parseArgs } from "node:util";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { z } from "zod/v4";
import type { PromotionBatchSchema } from "@shepherdjerred/ops-model/promotion/model.ts";
import { promotionStore } from "#activities/promotion/store.ts";
import { promotionConfig } from "#config/promotion.ts";
import { reportReceiptStore } from "#activities/reports/report-object-store.ts";
import {
  assertHandoffIdle,
  handoffBatch,
  handoffState,
} from "./handoff-state.ts";

export async function prepareProductionHandoff(directory: string) {
  const root = await realpath(directory);
  const db = new Database(path.join(root, "promotion.sqlite"), {
    readonly: true,
  });
  const Row = z.object({ key: z.string(), value: z.string() });
  let rows: z.infer<typeof Row>[];
  try {
    rows = z
      .array(Row)
      .parse(db.query("SELECT key,value FROM objects ORDER BY key").all());
  } finally {
    db.close();
  }
  const objects = new Map<string, unknown>(),
    artifacts = new Map<string, Uint8Array>();
  const batches: z.infer<typeof PromotionBatchSchema>[] = [];
  for (const row of rows) {
    const value: unknown = JSON.parse(row.value);
    if (row.key === "local/session.json") {
      assertHandoffIdle(value);
    } else if (row.key.startsWith("targets/")) {
      objects.set(row.key, await handoffState(value, root, artifacts));
    } else if (row.key.startsWith("local/batches/")) {
      const batch = handoffBatch(value);
      objects.set(`archives/${row.key}`, value);
      objects.set(`batches/${encodeURIComponent(batch.id)}.json`, batch);
      batches.push(batch);
    } else if (
      ["context/", "cleanup/", "ai/daily/", "solver/"].some((prefix) =>
        row.key.startsWith(prefix),
      )
    )
      objects.set(row.key, value);
  }
  objects.set(
    "batches/index.json",
    batches
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, 120)
      .map((b) => b.id),
  );
  return { objects, artifacts };
}

export async function applyProductionHandoff(
  plan: Awaited<ReturnType<typeof prepareProductionHandoff>>,
) {
  if (Bun.env["TEMPORAL_NAMESPACE"] !== "prod")
    throw new Error("Handoff requires explicit prod namespace");
  const config = await promotionConfig();
  if (!config.available)
    throw new Error(
      "A fresh publishing configuration is required before handoff",
    );
  if (config.enabled) throw new Error("Disable publishing before handoff");
  const store = promotionStore();
  const digest = createHash("sha256")
    .update(JSON.stringify([...plan.objects]))
    .digest("hex");
  const Receipt = z.object({
    version: z.literal(1),
    digest: z.string(),
    objects: z.number(),
    artifacts: z.number(),
    completedAt: z.iso.datetime(),
  });
  const existing = await store.read("handoff/complete.json", Receipt);
  if (existing !== undefined) {
    if (existing.value.digest !== digest)
      throw new Error("A different production handoff already completed");
    return existing.value;
  }
  const pending = await preflightWrites(store, plan.objects);
  const storage = reportReceiptStore();
  for (const [key, bytes] of plan.artifacts)
    await storage.client.send(
      new PutObjectCommand({
        Bucket: storage.bucket,
        Key: key,
        Body: bytes,
        ContentType: key.endsWith(".png") ? "image/png" : "application/json",
      }),
    );
  for (const item of pending)
    if (!(await store.put(item.key, item.value, undefined)))
      throw new Error(
        "Concurrent handoff state change; publishing must remain disabled",
      );
  const receipt = {
    version: 1,
    digest,
    objects: plan.objects.size,
    artifacts: plan.artifacts.size,
    completedAt: new Date().toISOString(),
  };
  if (!(await store.put("handoff/complete.json", receipt, undefined)))
    throw new Error(
      "Handoff receipt already exists; inspect the existing receipt",
    );
  return receipt;
}

async function preflightWrites(
  store: ReturnType<typeof promotionStore>,
  objects: Map<string, unknown>,
) {
  const pending: { key: string; value: unknown }[] = [];
  for (const [key, value] of objects) {
    const existing = await store.read(key, z.unknown());
    if (existing === undefined) pending.push({ key, value });
    else if (JSON.stringify(existing.value) !== JSON.stringify(value))
      throw new Error(`Production conflict at ${key}; no overwrite permitted`);
  }
  return pending;
}

if (import.meta.main) {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: { "state-dir": { type: "string" }, apply: { type: "boolean" } },
  });
  const plan = await prepareProductionHandoff(
    values["state-dir"] ??
      path.join(homedir(), ".local/state/the-storm/promotion"),
  );
  process.stdout.write(
    JSON.stringify(
      values.apply === true
        ? await applyProductionHandoff(plan)
        : {
            dryRun: true,
            objects: plan.objects.size,
            artifacts: plan.artifacts.size,
          },
    ) + "\n",
  );
}
