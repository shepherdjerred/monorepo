# session-fabric-spike

Phase-0 proving spike for the **iMessage ⇄ Temporal ⇄ CC/Codex session fabric**
(plan: iMessage ingress → Temporal → generic "run agent turn" → egress, with
durable per-session state so any session is chat-addressable later).

Goal: de-risk the novel assumptions **before** building the production system in
`packages/temporal`. Temporal mechanics are _not_ spiked (drain-to-idle,
signal-with-start, S3 records all have in-repo precedent); this targets the
unknowns.

Nothing here ships. `sandbox/` is exempt from the AI-architecture gate.

## Spike A — cross-host session resume ✅ PASS (codex + claude)

`bun src/spike-a.ts <codex|claude>`: turn 1 runs in container A (fresh fs),
pushes the provider session slice to SeaweedFS; turn 2 runs in a **separate
fresh container** that hydrates from S3 only, resumes, and must recall a
codeword told only in turn 1. Both providers recalled `PLUM-OCELOT-47`.

Proven:

- **Cross-host resume via an S3-round-tripped slice works** for both
  `codex.resumeThread(threadId)` (slice = `$CODEX_HOME/sessions/**`) and Claude
  Agent SDK `resume: sessionId` (slice = `~/.claude/projects/<cwd-hash>/<id>.jsonl`).
- **Headless subscription auth works in a Linux container** for both providers.
- SeaweedFS bundle store (per-file objects + manifest + `latest.json`) round-trips
  cleanly; hydrate/dehydrate is sub-second (kilobyte JSONL slices) — negligible vs
  the LLM turn.

## Findings that change the production plan

1. **Codex ChatGPT-sub auth is `auth.json`-in-`CODEX_HOME`, NOT an env token.**
   Setting `CODEX_ACCESS_TOKEN` flips the SDK into API-key mode and 401s against
   `api.openai.com`. Part 1 must materialize `auth.json` into `CODEX_HOME` (from a
   secret) rather than pass a bearer env var. `auth.json` is credential-grade and
   must be excluded from session bundles (already are — `EXCLUDED_BASENAMES`).
2. **Claude `bypassPermissions` refuses to run as root.** The agent container must
   run as a non-root uid (spike uses uid 1001) — which happens to align with the
   `agent-sdk-provider-isolation.md` uid-separation intent. The production agent
   worker should run the turn as non-root.
3. **Claude resume is cwd-sensitive.** The session JSONL lives under a
   `cwd`-derived project-dir hash, so resume requires the _same_ workspace path on
   every turn. The production `session-scratch` workspace must be a deterministic
   per-session path (the plan's manifest `workspacePath` guard enforces this).
4. Codex slice = 1 file, Claude slice = 2 files — both tiny; the per-file-object
   bundle approach (no tar dependency) is fine.

## Spike B — iMessage vertical slice (daemon ready; needs BlueBubbles install)

`src/spike-b-daemon.ts` is the full slice minus Temporal: BlueBubbles webhook →
guid dedupe → sender allowlist → agent turn (resuming from S3) → BlueBubbles REST
reply. Typechecks; runs on the Mac.

**Manual one-time setup (operator, GUI — not scriptable):**

1. Install the BlueBubbles Server app on this Mac; sign it into Messages; grant
   Full Disk Access. (Skip the Private API helper — not needed for text.)
2. In BlueBubbles settings set a server password and add a webhook →
   `http://<this-mac>:8787/webhook`, event "new-message".
3. `SPIKE_BB_URL=… SPIKE_BB_PASSWORD=… SPIKE_BB_ALLOW=<your imessage handle> \
 SPIKE_PROVIDER=claude <spike-a env> bun src/spike-b-daemon.ts`
4. Text yourself from another device; expect an agent reply, and a second text
   should resume the same session (codeword recall).

## Running Spike A yourself

Needs: Docker (OrbStack), `~/.codex/auth.json` (`codex login`), Claude Code
Keychain creds (`claude setup-token` or a normal login), and the `seaweedfs` AWS
profile. Creds are read locally and passed into containers via env — never printed
or committed. Spike objects live under `llm-archive/sandbox-spikes/` and are
cleaned after runs.
