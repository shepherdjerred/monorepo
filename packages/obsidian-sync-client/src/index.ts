import { loadConfig } from "./config.ts";
import { deriveScryptKey, createEncryptionProvider } from "./crypto.ts";
import { listVaults, accessVault } from "./api.ts";
import { SyncWebSocket } from "./websocket.ts";
import type { PushNotification } from "./ws-types.ts";
import { VaultManager } from "./vault.ts";
import { startWatcher } from "./watcher.ts";

async function handlePush(
  ws: SyncWebSocket,
  vault: VaultManager,
  notification: PushNotification,
): Promise<void> {
  // Deduplication: skip echoes of our own uploads
  if (ws.isJustPushed(notification)) {
    console.log(`  Skipping own push echo: ${notification.path}`);
    return;
  }

  const { path: filePath, uid, folder, deleted, mtime, ctime, size, hash } =
    notification;

  vault.version = Math.max(vault.version, uid);

  // Handle rename (relatedpath = old path, path = new path)
  const relatedPath = notification.relatedpath;
  if (relatedPath !== undefined && relatedPath !== "" && !deleted) {
    console.log(`  Renaming: ${relatedPath} -> ${filePath}`);
    await vault.renameFile(relatedPath, filePath, {
      uid,
      hash,
      mtime,
      ctime,
      size,
      folder,
      deleted: false,
    });
    await vault.saveState();
    return;
  }

  if (deleted) {
    console.log(`  Deleting: ${filePath}`);
    await vault.deleteFile(filePath);
    await vault.saveState();
    return;
  }

  if (folder) {
    console.log(`  Creating folder: ${filePath}`);
    await vault.createFolder(filePath, {
      uid,
      hash,
      mtime,
      ctime,
      size,
      folder: true,
      deleted: false,
    });
    await vault.saveState();
    return;
  }

  // Pull file content
  console.log(`  Pulling: ${filePath}`);
  const content = await ws.pull(uid);
  if (content === null) {
    console.log(`  File was deleted: ${filePath}`);
    await vault.deleteFile(filePath);
  } else {
    await vault.writeFile(filePath, content, {
      uid,
      hash,
      mtime,
      ctime,
      size,
      folder: false,
      deleted: false,
    });
    console.log(`  Written: ${filePath} (${String(content.byteLength)} bytes)`);
  }
  await vault.saveState();
}

async function main(): Promise<void> {
  const config = loadConfig();

  const token = config.token;
  console.log("Using token auth...");

  console.log("Listing vaults...");
  const { vaults, shared } = await listVaults(token);
  const allVaults = [...vaults, ...shared];
  const vault = allVaults.find((v) => v.name === config.vaultName);

  if (!vault) {
    const names = allVaults.map((v) => v.name).join(", ");
    throw new Error(
      `Vault "${config.vaultName}" not found. Available: ${names}`,
    );
  }

  console.log(
    `Found vault "${vault.name}" (encryption v${String(vault.encryption_version)})`,
  );

  // Derive encryption key from vault password + salt
  console.log("Deriving encryption keys...");
  const rawKey = await deriveScryptKey(config.vaultPassword, vault.salt);
  const provider = await createEncryptionProvider(
    vault.encryption_version,
    rawKey,
    vault.salt,
  );

  // Access vault to get the WebSocket host
  console.log("Requesting vault access...");
  const access = await accessVault({
    token,
    vaultUid: vault.id,
    keyhash: provider.keyHash,
    host: vault.host,
    encryptionVersion: vault.encryption_version,
  });

  const wsHost = access.host ?? vault.host;
  console.log(`WebSocket host: ${wsHost}`);

  // Load local vault state
  const vaultManager = new VaultManager(config.vaultPath);
  await vaultManager.loadState();
  console.log(
    `Local state: version=${String(vaultManager.version)}, files=${String(Object.keys(vaultManager.files).length)}`,
  );

  // Connect WebSocket
  const ws = new SyncWebSocket(provider);

  const onReady = (version: number): void => {
    console.log(`Server ready, version: ${String(version)}`);
    if (version > vaultManager.version) {
      vaultManager.version = version;
    }
  };

  const onPush = (notification: PushNotification): void => {
    console.log(
      `Push: ${notification.path} (uid=${String(notification.uid)}, folder=${String(notification.folder)}, deleted=${String(notification.deleted)})`,
    );
    void handlePush(ws, vaultManager, notification);
  };

  console.log("Connecting to sync server...");
  await ws.connect({
    host: wsHost,
    token,
    vaultId: vault.id,
    version: vaultManager.version,
    initial: vaultManager.isInitialSync,
    device: "obsidian-sync-client",
    onReady,
    onPush,
  });
  console.log("Connected. Listening for changes...");

  // Start file watcher for auto-push
  const watcher = startWatcher(config.vaultPath, vaultManager, ws);

  // Graceful shutdown
  const shutdown = async (): Promise<void> => {
    console.log("\nShutting down...");
    watcher.close();
    ws.disconnect();
    await vaultManager.saveState();
    console.log("State saved. Goodbye.");
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  // Keep alive - save state periodically
  setInterval(() => {
    void vaultManager.saveState();
  }, 30_000);
}

try {
  await main();
} catch (error: unknown) {
  console.error("Fatal error:", error);
  process.exit(1);
}
