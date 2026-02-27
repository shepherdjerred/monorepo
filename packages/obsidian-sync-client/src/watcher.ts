import { watch, type FSWatcher } from "node:fs";
import path from "node:path";

import type { VaultManager } from "./vault.ts";
import type { SyncWebSocket } from "./websocket.ts";

const DEBOUNCE_MS = 200;
const STATE_FILENAME = ".obsidian-sync-state.json";

function shouldIgnore(filePath: string): boolean {
  if (filePath === STATE_FILENAME) return true;
  const firstSegment = filePath.split("/")[0] ?? "";
  if (firstSegment.startsWith(".")) return true;
  return false;
}

async function checkExists(fullPath: string): Promise<boolean> {
  return Bun.file(fullPath).exists();
}

async function handleFileChange(
  filePath: string,
  deleted: boolean,
  vault: VaultManager,
  ws: SyncWebSocket,
): Promise<void> {
  if (vault.isJustWritten(filePath)) return;

  if (deleted) {
    const entry = vault.getEntry(filePath);
    if (entry === undefined || entry.deleted) return;

    console.log(`  Watcher: deleting ${filePath}`);
    void ws.push({
      path: filePath,
      relatedPath: null,
      folder: false,
      deleted: true,
      ctime: 0,
      mtime: 0,
      hash: "",
      data: null,
    });
    return;
  }

  const content = await vault.readFileContent(filePath);
  const fileStat = await vault.getFileStat(filePath);
  if (fileStat === null) return;

  const entry = vault.getEntry(filePath);
  if (entry?.mtime === fileStat.mtime && entry.size === fileStat.size) {
    return;
  }

  console.log(`  Watcher: pushing ${filePath} (${String(content.byteLength)} bytes)`);
  void ws.push({
    path: filePath,
    relatedPath: null,
    folder: false,
    deleted: false,
    ctime: fileStat.mtime,
    mtime: fileStat.mtime,
    hash: "",
    data: content,
  });
}

export function startWatcher(
  vaultPath: string,
  vault: VaultManager,
  ws: SyncWebSocket,
): FSWatcher {
  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const watcher = watch(vaultPath, { recursive: true }, (_event, filename) => {
    if (filename === null) return;
    const filePath = filename.replaceAll("\\", "/");

    if (shouldIgnore(filePath)) return;

    const existing = debounceTimers.get(filePath);
    if (existing !== undefined) {
      clearTimeout(existing);
    }

    debounceTimers.set(
      filePath,
      setTimeout(() => {
        debounceTimers.delete(filePath);
        const fullPath = path.join(vaultPath, filePath);
        void (async () => {
          const exists = await checkExists(fullPath);
          await handleFileChange(filePath, !exists, vault, ws);
        })();
      }, DEBOUNCE_MS),
    );
  });

  console.log("File watcher started.");
  return watcher;
}
