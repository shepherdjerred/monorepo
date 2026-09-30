import { afterEach, expect, test, vi } from "vitest";
import { truncate } from "node:fs/promises";
import path from "node:path";
import {
  MAX_SESSION_FILE_BYTES,
  SESSION_CHUNK_BYTES,
  pushSessionCheckpoint,
  pullSessionCheckpoint,
} from "./session-checkpoint.ts";
import {
  memoryAgentChatStore,
  temporaryDirectoryTracker,
} from "./test-support.ts";

const directories = temporaryDirectoryTracker("session-checkpoint-test-");
const blobsPrefix = "agent-chats/sessions/chat-1/blobs/";
afterEach(async () => directories.cleanup());

test("appending a transcript uploads only changed chunks and restores it incrementally", async () => {
  const directory = await directories.create();
  const source = path.join(directory, "session.jsonl");
  const text = `${"a".repeat(SESSION_CHUNK_BYTES)}${"b".repeat(SESSION_CHUNK_BYTES)}tail`;
  await Bun.write(source, text);
  const store = memoryAgentChatStore();
  const first = await pushSessionCheckpoint({
    store,
    filePath: source,
    blobsPrefix,
    forbiddenTokens: [],
  });
  const put = vi.spyOn(store, "put");
  await Bun.write(source, `${text}-continued`);
  const second = await pushSessionCheckpoint({
    store,
    filePath: source,
    blobsPrefix,
    forbiddenTokens: [],
  });
  expect(put).toHaveBeenCalledOnce();
  expect(second.chunks.slice(0, 2)).toEqual(first.chunks.slice(0, 2));
  expect(
    second.chunks.every((chunk) => chunk.bytes <= SESSION_CHUNK_BYTES),
  ).toBe(true);
  const destination = path.join(directory, "restored.jsonl");
  await pullSessionCheckpoint({
    store,
    checkpoint: second,
    destination,
    blobsPrefix,
  });
  expect(await Bun.file(destination).text()).toBe(`${text}-continued`);
});

test("rejects a credential split across chunks before uploading any bytes", async () => {
  const directory = await directories.create();
  const source = path.join(directory, "session.jsonl");
  const token = "mounted-🔥-credential";
  await Bun.write(source, `${"x".repeat(SESSION_CHUNK_BYTES - 10)}${token}`);
  const store = memoryAgentChatStore();
  await expect(
    pushSessionCheckpoint({
      store,
      filePath: source,
      blobsPrefix,
      forbiddenTokens: [token],
    }),
  ).rejects.toThrow("mounted credential");
  expect(store.objects.size).toBe(0);
});

test("rejects oversized files before reading or uploading them", async () => {
  const directory = await directories.create();
  const source = path.join(directory, "session.jsonl");
  await Bun.write(source, "");
  await truncate(source, MAX_SESSION_FILE_BYTES + 1);
  const store = memoryAgentChatStore();
  await expect(
    pushSessionCheckpoint({
      store,
      filePath: source,
      blobsPrefix,
      forbiddenTokens: [],
    }),
  ).rejects.toThrow("128 MiB");
  expect(store.objects.size).toBe(0);
});

test("rejects corrupt or cross-chat content-addressed chunks", async () => {
  const directory = await directories.create();
  const source = path.join(directory, "session.jsonl");
  await Bun.write(source, "session data");
  const store = memoryAgentChatStore();
  const checkpoint = await pushSessionCheckpoint({
    store,
    filePath: source,
    blobsPrefix,
    forbiddenTokens: [],
  });
  const chunk = checkpoint.chunks[0];
  if (chunk === undefined) throw new Error("Expected a nonempty checkpoint");
  const destination = path.join(directory, "restored.jsonl");
  await expect(
    pullSessionCheckpoint({
      store,
      checkpoint,
      destination,
      blobsPrefix: "agent-chats/sessions/other-chat/blobs/",
    }),
  ).rejects.toThrow("content hash");
  await store.put(chunk.key, new TextEncoder().encode("corrupt data"));
  await expect(
    pullSessionCheckpoint({ store, checkpoint, destination, blobsPrefix }),
  ).rejects.toThrow("integrity check failed");
});
