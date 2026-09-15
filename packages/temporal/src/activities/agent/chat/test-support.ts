import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AgentChatObjectStore } from "./session-store.ts";

export function memoryAgentChatStore(): AgentChatObjectStore & {
  objects: Map<string, Uint8Array>;
} {
  const objects = new Map<string, Uint8Array>();
  return {
    objects,
    has: (key) => Promise.resolve(objects.has(key)),
    get: (key) => {
      const value = objects.get(key);
      if (value === undefined) throw new Error(`missing ${key}`);
      return Promise.resolve(value);
    },
    put: (key, body) => {
      objects.set(key, body);
      return Promise.resolve();
    },
  };
}

export function temporaryDirectoryTracker(prefix: string): {
  create: () => Promise<string>;
  cleanup: () => Promise<void>;
} {
  const directories: string[] = [];
  return {
    create: async () => {
      const directory = await mkdtemp(path.join(tmpdir(), prefix));
      directories.push(directory);
      return directory;
    },
    cleanup: async () => {
      await Promise.all(
        directories
          .splice(0)
          .map((directory) => rm(directory, { recursive: true, force: true })),
      );
    },
  };
}
