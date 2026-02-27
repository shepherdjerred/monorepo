# Obsidian Sync Client

Headless TypeScript client that connects to Obsidian's official sync servers and keeps a local directory in sync. Reverse-engineered from Obsidian's `app.js` (v1.11.7).

## NOT a workspace member

This package has its own `node_modules` — always `cd packages/obsidian-sync-client` before running commands.

## Quick Reference

```bash
bun install                          # Install deps
bun run typecheck                    # Type check
bun test                             # Run tests
bunx eslint . --max-warnings=0       # Lint
bun run build                        # Compile to binary (dist/obsidian-sync-client)
bun run start                        # Run directly
```

## Architecture

- **crypto.ts** — scrypt key derivation, HKDF multi-output (keyhash, AES-GCM, SIV-Enc, SIV-Mac), AES-256-GCM encrypt/decrypt
- **aes-siv.ts** — AES-SIV deterministic path encryption (CMAC + CTR mode)
- **api.ts** — REST client for `api.obsidian.md` (signin, vault list, vault access)
- **websocket.ts** — WebSocket sync protocol (init, pull, push, heartbeat, operation queue)
- **ws-types.ts** — Zod schemas and types for WebSocket messages
- **vault.ts** — Local file I/O + sync state persistence (`.obsidian-sync-state.json`)
- **config.ts** — Zod-validated env config
- **index.ts** — CLI entrypoint

## Encryption (v2/v3)

```
scrypt(password.NFKC, salt.NFKC, N=32768, r=8, p=1, dkLen=32)
  → HKDF base key
    ├→ deriveKey(salt=vaultSalt, info="ObsidianKeyHash")     → keyhash (sent to server)
    ├→ deriveKey(salt=EMPTY,     info="ObsidianAesGcm")      → AES-256-GCM key (file content)
    ├→ deriveKey(salt=vaultSalt, info="ObsidianAesSivEnc")   → AES-CTR key (path SIV)
    └→ deriveKey(salt=vaultSalt, info="ObsidianAesSivMac")   → AES-CBC key (path CMAC)
```

CRITICAL: AES-GCM key uses EMPTY salt. All others use vault salt.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OBSIDIAN_EMAIL` | Yes | Obsidian account email |
| `OBSIDIAN_PASSWORD` | Yes | Obsidian account password |
| `OBSIDIAN_VAULT_PASSWORD` | Yes | E2E encryption password |
| `OBSIDIAN_VAULT_NAME` | Yes | Vault name to sync |
| `VAULT_PATH` | Yes | Local directory for synced files |

## Protocol Notes

- WebSocket operations are serialized (one at a time via operation queue)
- Files transfer in 2MB chunks; `perFileMax` from server (~200MB) enforced
- `justPushed` map deduplicates own push echoes
- `relatedpath` in push notifications indicates file renames
- Heartbeat: ping if idle >10s, disconnect if >120s
- Version tracking: UID-based, persisted to state file
