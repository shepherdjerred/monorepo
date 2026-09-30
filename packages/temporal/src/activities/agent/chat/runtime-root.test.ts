import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { temporaryDirectoryTracker } from "./test-support.ts";
import { prepareAgentChatRuntimeRoot } from "./runtime-root.ts";

const temporaryDirectories = temporaryDirectoryTracker(
  "agent-chat-runtime-root-test-",
);

afterEach(async () => {
  await temporaryDirectories.cleanup();
});

test("removes crash leftovers before recreating a traversable runtime root", async () => {
  const parent = await temporaryDirectories.create();
  const runtimeRoot = path.join(parent, "agent-chats");
  await mkdir(path.join(runtimeRoot, "abandoned-chat", "workspace"), {
    recursive: true,
  });
  await Bun.write(
    path.join(runtimeRoot, "abandoned-chat", "workspace", "transcript"),
    "private",
  );

  await prepareAgentChatRuntimeRoot(runtimeRoot);

  expect(await Array.fromAsync(new Bun.Glob("**/*").scan(runtimeRoot))).toEqual(
    [],
  );
  const runtimeRootStat = await stat(runtimeRoot);
  expect(runtimeRootStat.mode & 0o777).toBe(0o711);
});
