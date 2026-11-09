import { expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod/v4";
import { memoryPromotionStore } from "#activities/promotion/test-support.ts";
import {
  readPromotionState,
  updatePromotionState,
} from "#activities/promotion/store.ts";
import { localCleanup } from "./local-cleanup.ts";

it("cleans an exact saved reply without publishing or changing the bump history", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "cleanup-"));
  const socket = path.join(directory, "daemon.sock");
  const store = memoryPromotionStore();
  const occurrenceId = "saved-bump";
  const targetId = "disboard-native-bump";
  await updatePromotionState(store, targetId, (state) => ({
    ...state,
    attempts: [
      {
        occurrenceId,
        attemptedAt: "2026-11-07T12:00:00Z",
        settledAt: "2026-11-07T12:00:01Z",
        status: "verified",
        receiptUrl:
          "https://discord.com/channels/1043751242649829436/1043751242649829439/123456789",
        evidenceKey: null,
        contentHash: "fixture",
        beforeSubmission: [],
      },
    ],
  }));
  const before = await readPromotionState(store, targetId);
  const requests: string[] = [];
  let canManageMessages = true;
  const server = Bun.serve({
    unix: socket,
    async fetch(request) {
      const endpoint = new URL(request.url).pathname;
      requests.push(endpoint);
      if (endpoint === "/status")
        return Response.json({
          identities: { user: { id: "1560536854556839948" } },
        });
      if (endpoint === "/channel")
        return Response.json({
          id: "1043751242649829439",
          guildId: "1043751242649829436",
          canManageMessages,
        });
      if (endpoint === "/delete-reply") {
        expect(await request.json()).toEqual({
          guildId: "1043751242649829436",
          channelId: "1043751242649829439",
          messageId: "123456789",
          expectedAuthorId: "302050872383242240",
        });
        return Response.json({ deleted: true, alreadyAbsent: true });
      }
      throw new Error("Unexpected publication request");
    },
  });
  try {
    const result = await localCleanup({
      store,
      directory,
      targetId,
      occurrenceId,
      socket,
    });
    expect(result.status).toBe("verified");
    expect(result.cleanup.status).toBe("already-absent");
    expect(await readPromotionState(store, targetId)).toEqual(before);
    expect(requests).toEqual(["/status", "/channel", "/delete-reply"]);
    const files = await Array.fromAsync(
      new Bun.Glob("runs/*/summary.json").scan(directory),
    );
    expect(files).toHaveLength(1);
    expect(
      await Bun.file(path.join(directory, z.string().parse(files[0]))).json(),
    ).toMatchObject([{ cleanup: { status: "already-absent" } }]);

    requests.length = 0;
    canManageMessages = false;
    await expect(
      localCleanup({ store, directory, targetId, occurrenceId, socket }),
    ).rejects.toThrow();
    expect(requests).toEqual(["/status", "/channel"]);
    expect(await readPromotionState(store, targetId)).toEqual(before);
  } finally {
    await server.stop(true);
    await rm(directory, { recursive: true });
  }
});
