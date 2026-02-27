#!/usr/bin/env bun
/**
 * Test: push a file to Obsidian Sync, then verify it arrives in the real vault.
 *
 * Usage:
 *   OBSIDIAN_TOKEN=... OBSIDIAN_VAULT_PASSWORD=... OBSIDIAN_VAULT_NAME="Main Vault" \
 *   VAULT_PATH=/tmp/obsidian-test-vault bun run scripts/test-push.ts
 */
import { loadConfig } from "../src/config.ts";
import { deriveScryptKey, createEncryptionProvider } from "../src/crypto.ts";
import { listVaults, accessVault } from "../src/api.ts";
import { SyncWebSocket } from "../src/websocket.ts";

const config = loadConfig();
const token = config.token ?? "";

console.log("Listing vaults...");
const { vaults, shared } = await listVaults(token);
const allVaults = [...vaults, ...shared];
const vault = allVaults.find((v) => v.name === config.vaultName);
if (!vault) throw new Error(`Vault "${config.vaultName}" not found`);

console.log(`Found vault "${vault.name}" (encryption v${String(vault.encryption_version)})`);

console.log("Deriving encryption keys...");
const rawKey = await deriveScryptKey(config.vaultPassword, vault.salt);
const provider = await createEncryptionProvider(vault.encryption_version, rawKey, vault.salt);

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

const ws = new SyncWebSocket(provider);

// Load vault state to get the saved version (skip re-downloading everything)
import { VaultManager } from "../src/vault.ts";
const vaultManager = new VaultManager(config.vaultPath);
await vaultManager.loadState();
console.log(`Local state: version=${String(vaultManager.version)}, files=${String(Object.keys(vaultManager.files).length)}`);

await ws.connect({
  host: wsHost,
  token,
  vaultId: vault.id,
  version: vaultManager.version,
  initial: vaultManager.isInitialSync,
  device: "obsidian-sync-client-test",
  onReady: (version) => {
    console.log(`Server ready, version: ${String(version)}`);
  },
  onPush: (notification) => {
    console.log(`  Received push: ${notification.path} (deleted=${String(notification.deleted)})`);
  },
});

// Wait briefly for connection to stabilize
await new Promise((r) => setTimeout(r, 1000));

// Push a test file
const testPath = "_sync-client-test.md";
const testContent = `---\ntitle: Sync Client Test\n---\nThis file was created by obsidian-sync-client at ${new Date().toISOString()}\n`;
const testData = new TextEncoder().encode(testContent).buffer;
const now = Date.now();

// Compute SHA-256 hash of content (hex-encoded) — this is what Obsidian expects
const hashBuffer = await crypto.subtle.digest("SHA-256", testData);
const hashHex = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");

console.log(`\nPushing test file: ${testPath} (hash=${hashHex.slice(0, 16)}...)`);
await ws.push({
  path: testPath,
  relatedPath: null,
  folder: false,
  deleted: false,
  ctime: now,
  mtime: now,
  hash: hashHex,
  data: testData,
});
console.log("Push completed!");

// Wait a moment then clean up by deleting the test file
await new Promise((r) => setTimeout(r, 2000));

console.log(`Deleting test file: ${testPath}`);
await ws.push({
  path: testPath,
  relatedPath: null,
  folder: false,
  deleted: true,
  ctime: 0,
  mtime: 0,
  hash: "",
  data: null,
});
console.log("Delete completed!");

// Wait for echo
await new Promise((r) => setTimeout(r, 2000));

ws.disconnect();
console.log("\nDone. Check your Obsidian app — the test file should have briefly appeared then been deleted.");
process.exit(0);
