import { mkdir, chmod } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { PromotionStore } from "#activities/promotion/store.ts";
import { readPromotionState } from "#activities/promotion/store.ts";
import { promotionTarget } from "#activities/promotion/manifest.ts";
import { cleanupDiscordReply } from "#activities/promotion/discord-cleanup.ts";
import { createLocalJournal } from "./local-journal.ts";

/** Exact saved receipt only. No provider, publication, or cooldown mutation. */
export async function localCleanup({
  store,
  directory,
  targetId,
  occurrenceId,
  socket,
}: {
  store: PromotionStore;
  directory: string;
  targetId: string;
  occurrenceId: string;
  socket: string;
}) {
  const target = promotionTarget(targetId);
  if (targetId !== "disboard-native-bump")
    throw new Error("Cleanup is restricted to DISBOARD");
  const state = await readPromotionState(store, targetId);
  if (state.lock !== null)
    throw new Error("Target is owned; settle its execution first");
  const attempt = state.attempts.find(
    (a) => a.occurrenceId === occurrenceId && a.status === "verified",
  );
  if (attempt?.receiptUrl == null)
    throw new Error("Cleanup requires an exact saved verified receipt");
  const request = async (endpoint: string, body?: unknown) => {
    const r = await fetch(`http://discord${endpoint}`, {
      unix: socket,
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) throw new Error(`Cleanup daemon HTTP ${String(r.status)}`);
    return await r.json();
  };
  z.object({
    identities: z.object({
      user: z.object({ id: z.literal("1560536854556839948") }),
      bot: z.never().optional(),
    }),
  }).parse(await request("/status"));
  z.object({
    id: z.literal("1043751242649829439"),
    guildId: z.literal("1043751242649829436"),
    canManageMessages: z.literal(true),
  }).parse(await request("/channel?channelId=1043751242649829439"));
  const id = crypto.randomUUID(),
    journal = await createLocalJournal(store, id, "cleanup", {
      targetIds: [targetId],
      scope: "selected",
    });
  await journal.update(targetId, {
    status: "running",
    phase: "Receipt cleanup",
    startedAt: new Date().toISOString(),
    occurrenceId,
  });
  try {
    const cleanup = await cleanupDiscordReply({
      target,
      mode: "reconcile",
      result: { receipt: { status: "verified", url: attempt.receiptUrl } },
      request,
    });
    if (cleanup === null)
      throw new Error("Saved receipt did not match cleanup assignment");
    const summary =
      cleanup.status === "blocked"
        ? z.string().parse(cleanup.summary)
        : `Confirmation ${cleanup.status}`;
    const output = path.join(directory, "runs", id);
    await mkdir(output, { recursive: true, mode: 0o700 });
    const file = path.join(output, "summary.json");
    await Bun.write(
      file,
      JSON.stringify(
        [
          {
            targetId,
            result: {
              status: cleanup.status === "blocked" ? "blocked" : "verified",
              summary,
              receipt: { url: attempt.receiptUrl },
            },
            cleanup,
          },
        ],
        null,
        2,
      ),
    );
    await chmod(file, 0o600);
    if (
      !(await store.put(
        `cleanup-retries/${encodeURIComponent(occurrenceId)}/${id}.json`,
        { targetId, occurrenceId, cleanup, at: new Date().toISOString() },
        undefined,
      ))
    )
      throw new Error("Cleanup retry audit collision");
    await journal.update(targetId, {
      status: "completed",
      phase: cleanup.status,
      summary,
      finishedAt: new Date().toISOString(),
    });
    await journal.finish();
    return {
      targetId,
      status: cleanup.status === "blocked" ? "blocked" : "verified",
      cleanup,
      summary,
    };
  } catch (error) {
    await journal.update(targetId, {
      status: "failed",
      phase: "Cleanup failed",
      summary: "Cleanup failed; inspect the saved receipt before retrying",
      finishedAt: new Date().toISOString(),
    });
    await journal.finish();
    throw error;
  }
}
