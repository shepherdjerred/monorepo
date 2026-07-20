---
id: reference-completed-2026-06-12-discord-agent-skill
type: reference
status: complete
board: false
---

# `discord` skill — let AI agents interact with Discord via TypeScript scripts

## Context

Goal: let Claude Code / Codex interact with Discord (send/read messages, invoke slash commands, join voice) to make iterating on Discord bots easier (streambot, birmel, discord-plays-pokemon).

A survey of existing Discord MCP servers found none fit: bot-token servers can't invoke another bot's slash commands or sit in voice as a user; the one selfbot MCP is text-only. Decision (user-confirmed): **no MCP server, no helper package** — a `discord` skill that teaches the agent to write & run short TypeScript scripts using the Discord npm packages already in the repo, with examples verified live against the dedicated test server.

Building blocks that already existed:

- **Libs** (installed in `packages/streambot`): `discord.js` ^14 (bot), `discord.js-selfbot-v13` ^3.7 (userbot — `sendSlash` + voice presence), `@shepherdjerred/discord-video-stream` fork (actual media streaming).
- **Test server**: guild `1337623164146155593`, voice ch `1337623164955398253`, text ch `1337631455085334650`.
- **Tokens**: `streambot-config` 1P item (Homelab (Kubernetes) vault) — `BOT_TOKEN` (bot `Glidiot Helper#1544`), `TOKEN` (userbot `glidiot_`).
- **Reference**: `packages/streambot/e2e/run.ts` (dual-identity e2e), `packages/streambot/src/streamer/streamer.ts` (voice join via the fork).

## Deliverables

1. **`discord` skill** — `packages/dotfiles/dot_agents/skills/discord/SKILL.md` (chezmoi source) + live copy at `~/.agents/skills/discord/SKILL.md`. Covers: identity selection (userbot vs bot), ask-the-user credential sourcing (single-batched-`op` loading), standalone scratch-dir workflow (`bun add discord.js discord.js-selfbot-v13 debug` in a temp dir), and live-verified examples (send/read, sendSlash round-trip, gateway-op4 voice join + voice-state verification), plus gotchas. Per user direction the skill is fully generic: agents may act on any server the chosen identity is in, must ask the user for credentials and targets, and the skill names no specific monorepo bots, servers, or 1P items.
2. **Gitignore** — `packages/streambot/scratch/` added to root `.gitignore` (used during this session's verification; the skill itself recommends a temp dir).
3. This plan doc.

## Verification performed (live, 2026-06-12)

Combined script `packages/streambot/scratch/verify-skill.ts` (gitignored, kept for reuse), one `op` call for both tokens:

- **A — send/read**: userbot sent a marker message to the test text channel; bot read it back via `messages.fetch`. PASS.
- **B — sendSlash round-trip**: bot registered guild slash command `/agent-ping`; userbot invoked it via `channel.sendSlash(botId, "agent-ping")`; bot received the interaction and replied; command deregistered after. PASS.
- **C — voice join**: userbot joined the test voice channel via raw gateway VoiceStateUpdate (op 4) broadcast; bot observed the voice state (`channelId`, `streaming`, `selfVideo` flags readable); userbot left. PASS.

Findings baked into the skill as gotchas:

- `user.voice.joinChannel()` (selfbot built-in) fails with `VOICE_CONNECTION_TIMEOUT` — it attempts a full media handshake with deprecated encryption. Gateway op 4 (`client.ws.broadcast`) is the correct presence-only join, same mechanism the discord-video-stream fork uses.
- Selfbot `destroy()` can throw on an already-gone websocket — teardown must guard it or it masks the real error.
- Bot-side message reads need the privileged `MessageContent` intent; voice-state observation needs `GuildVoiceStates`.
- Slash command registration → `sendSlash` has ~3s cache lag.

## Out of scope (deliberate)

- No MCP server, no `toolkit discord` subcommand, no helper library, no daemon — revisit only if script-writing friction proves annoying in practice.
- No audio/video sending from agent scripts — that's streambot's job via the discord-video-stream fork; agents observe.
- No new Discord account provisioning — reuses the existing test identities.

## Session Log — 2026-06-12

### Done

- Researched Discord MCP server landscape (none fit: slash-command invocation + voice-as-user require a userbot).
- Wrote and live-verified `packages/streambot/scratch/verify-skill.ts` — all 3 checks passed against the test guild.
- Authored `discord` skill: `packages/dotfiles/dot_agents/skills/discord/SKILL.md` + live copy in `~/.agents/skills/discord/`.
- Revised per user feedback (twice): removed the test-server-only restriction (any server is allowed) and the assumed `streambot-config` credentials (agents must ask the user for the correct creds/1P item and targets); then removed all mentions of specific monorepo bots/projects from the skill, switching the script workflow to a standalone temp dir (`bun add discord.js@^14 discord.js-selfbot-v13@^3.7 debug` — `debug` is required because a selfbot transitive dep, werift-rtp, fails to declare it; verified by smoke test).
- Added `packages/streambot/scratch/` to root `.gitignore`.
- This plan doc; PR from branch `feature/discord-agent-skill`.

### Remaining

- Nothing for this task. Future option (only if friction appears): wrap the patterns in a `toolkit discord` subcommand or MCP server.

### Caveats

- Per user direction, the skill does NOT restrict agents to the test server — any server the identity is in is allowed, and agents must ask the user which credentials/1P item and target guild to use (the streambot test setup is documented as one example). The userbot is a real account, so deliberation in shared servers is on the agent.
- `discord.js-selfbot-v13` is archived upstream; if Discord changes the gateway, `sendSlash`/op-4 join may break with no upstream fix.
- Voice join is presence-only (no media). Verifying _stream content_ (frames/audio) is not possible with this setup — only the `streaming` flag.

## Phase 2 — `toolkit discord` daemon (tooling)

The user asked to build tooling to reduce the friction of the script approach (one `op` approval per run, ~5s login per run, ~50 lines of boilerplate, no persistent voice presence). Added a `toolkit discord` subcommand: a **session daemon** that logs in once (one `op` call), holds the gateway connections + tokens in memory, and exposes one-shot CLI commands over a `~/.toolkit/discord/daemon.sock` unix socket.

Design:

- Detached `discord serve` process spawned from `daemon start`; tokens via **env, never argv**; state in `~/.toolkit/discord/` (`daemon.sock` 0600, `state.json` with no secrets, `logs/`). Idle TTL (default 4h) auto-exits so a selfbot is never left connected.
- Either/both `DISCORD_BOT_TOKEN` / `DISCORD_USER_TOKEN`; commands route to the identity they need (slash + voice join → userbot; voice states → bot).
- Commands: `daemon start|stop|status`, `whoami`, `guilds`, `channels`, `send`, `read`, `wait` (long-poll for a matching message), `slash`, `voice join|leave|states`. Markdown out, `--json` everywhere.
- Files: `src/lib/discord/{ipc,handlers,serve,client,render}.ts`, `src/commands/discord/*.ts`, `src/handlers/discord.ts`, routing in `src/index.ts`; unit tests in `test/discord/`.

### Phase 2 findings (encoded as code/docs)

- `bun build --compile` needs `--external ffmpeg-static` (optional native dep of a voice transitive); both Discord libs otherwise bundle fine (verified by binary smoke test).
- **`Bun.file(path).exists()` returns false for a unix socket** — it broke the daemon readiness poll and `whoami`/`stop` until replaced with a stat-based `pathExists()`. (Root cause of a confusing "daemon did not become ready" where the daemon was actually up and listening.)
- selfbot `destroy()` throws on an already-closed socket — caught in the daemon's shutdown path.

### Phase 2 verification (live, 2026-06-12, test userbot only)

Started the daemon with only the user's dedicated test 1P item (userbot `derrej_`, no bot token). Verified end-to-end against the user's test guild: `whoami`, `guilds` (discovered 2 servers), `channels`, `send` (as user) → `read` round-trip, `voice join` → `whoami` shows **persistent** voice presence across separate CLI invocations → `voice leave`, `wait` round-trip (blocked then matched a sent message), `voice states` returns the correct "needs a bot identity" error, clean `daemon stop`. Confirmed the token never appears in `ps` args, `state.json`, or the logs.

### Phase 2 caveats

- `voice states` and reliable message-content reads need a **bot** token; the default test item is userbot-only.
- Daemon is macOS/Linux (unix socket). Detached via `node:child_process` `detached + unref`.
