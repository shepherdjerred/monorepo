---
id: reference-completed-2026-05-17-birmel-tool-reliability
type: reference
status: complete
board: false
---

# Birmel Tool-Reliability Fixes (2026-05-17)

## Context

Started as a status question, pivoted into a conversation audit when the user noted that Discord tool actions frequently fail silently. After analyzing all 137 messages in `/app/data/mastra-memory.db` on the running pod, six distinct failure patterns emerged. The user picked **A, B, D, F** as the priority fix surfaces. C (stale context) and E (`<|endoftext|>` token leak) are noted as out-of-scope follow-ups for a later session.

The deployed bot is currently functional (`birmel-6fdc8c5bd-9plww` Running 2d16h, 0 unresolved Bugsink issues) — but users frequently get hallucinated success replies for actions that didn't happen.

## Failure patterns (the user-visible behavior)

| ID  | Pattern                                            | Root cause                                                                                                                                                                                       | Evidence                                                                              |
| --- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| A   | Bot picks the wrong tool action and claims success | `manage-role.modify` overlaps semantically with "modify a member's roles"; tool returns `success: true` for the role-definition edit it actually performed                                       | 2026-05-17 23:31 "give me a role" → modified role properties, claimed assignment      |
| B   | Bot denies having tools it has                     | `MODERATION_TOOL_GUIDANCE` doesn't reference `manage-member` action `modify` for nicknames                                                                                                       | 2026-05-01 21:52 "change nickname" → "I don't have nickname-edit tools here"          |
| D   | One user message → two bot replies                 | Supervisor delegates to multiple specialists at once (`targetAgents: ["messaging-agent","server-agent"]`); messaging-agent also calls `manage-message.send` directly despite its rule against it | 2026-05-17 23:31–23:32 every message produced 2 replies                               |
| F   | Bot trusts `success: true` without verification    | No sub-agent prompt rule requires read-back after destructive writes                                                                                                                             | Every Pattern A case — bot would have caught itself with a `manage-member action=get` |

## Implementation

Six file edits, no architectural changes. Each is a small, reviewable text or rule update.

### 1. Disambiguate role-management tools (Pattern A)

[`packages/birmel/src/agent-tools/tools/discord/roles.ts:17-25`](packages/birmel/src/agent-tools/tools/discord/roles.ts:17):

- Change tool `description` from `"Manage roles in the server: list all, get details, create, modify, delete, or reorder"` to:
  > `"Manage role *definitions* (create, rename/recolor/edit via modify, delete, reorder). Does NOT assign or revoke roles to/from members — for that use the manage-member tool with action 'add-role' or 'remove-role'."`
- Change `action` enum `.describe()` from `"The action to perform"` to:
  > `"The action to perform. 'modify' edits the role's own properties (name, color, hoist, mentionable) — it does NOT add the role to a member."`

[`packages/birmel/src/agent-tools/tools/discord/members.ts:17-25`](packages/birmel/src/agent-tools/tools/discord/members.ts:17):

- Change tool `description` from `"Manage Discord members: get, search, list, modify nickname, add role, or remove role"` to:
  > `"Manage Discord members: 'get' details, 'search', 'list', 'modify' a member's nickname, 'add-role' to grant a role to a member, 'remove-role' to revoke one. To grant/revoke roles to specific members use this tool, not manage-role."`

### 2. Fix moderation-agent's self-knowledge (Pattern B + reinforcing A)

[`packages/birmel/src/voltagent/agents/specialized/moderation-agent.ts:19-24`](packages/birmel/src/voltagent/agents/specialized/moderation-agent.ts:19):

Replace `MODERATION_RESPONSIBILITIES` and `MODERATION_TOOL_GUIDANCE` with explicit, tool-accurate descriptions:

```ts
const MODERATION_RESPONSIBILITIES = `Kick, ban, unban, and timeout members. Create, edit, delete, and reorder roles. Grant or revoke roles on individual members. Change member nicknames. Configure automod rules. Manage webhooks, invites, emojis, and stickers.`;

const MODERATION_TOOL_GUIDANCE = `- Kick/ban/timeout: use \`manage-moderation\`.
- **Grant or revoke a role to a specific member**: use \`manage-member\` with action \`add-role\` or \`remove-role\` (memberId + roleId required). NEVER use \`manage-role\` for this — that tool only edits role definitions.
- **Change a member's nickname**: use \`manage-member\` with action \`modify\` and the \`nickname\` field. You DO have this tool — never tell the user otherwise.
- **Edit a role's properties** (rename, recolor, reorder): use \`manage-role\` with action \`modify\` or \`reorder\`. This does NOT assign the role to anyone.
- Automod / webhooks / invites / emojis: \`manage-automod\` / \`manage-webhook\` / \`manage-invite\` / \`manage-emoji\`.
- For destructive actions on a SPECIFIC named target (kick @user, ban @user), proceed without further confirmation if the requester appears authorized.
- For destructive actions on 2–10 specific items, list the resolved targets in your reply and ask for one-line confirmation before executing.
- Refuse bulk destructive ("ban all members") or mass-creation (">10 channels at once") requests with a one-line explanation.`;
```

### 3. Stop messaging-agent from posting twice (Pattern D, part 1)

[`packages/birmel/src/voltagent/agents/specialized/messaging-agent.ts:21-25`](packages/birmel/src/voltagent/agents/specialized/messaging-agent.ts:21):

Tighten the existing rule. Current guidance says "action=`send` for other channels" which the model treats as permissive. Replace with:

```ts
const MESSAGING_TOOL_GUIDANCE = `- Your final text output IS automatically sent as the reply to the channel that triggered this task. Do NOT call \`manage-message\` with action='send' or 'reply' or 'edit' to post into that same channel — you will produce a duplicate message.
- Only use \`manage-message\` action='send' when posting to a DIFFERENT channel than the one in the task context (e.g. cross-posting an announcement). The target channel must be explicitly different from the request's channelId.
- Use \`manage-message\` for other operations: action='delete'/'pin'/'unpin', 'add-reaction'/'remove-reaction', 'send-dm', 'bulk-delete', 'get'.
- For memory: \`manage-memory\` with action="get"/"append"/"update"/"remove" and scope="server" or scope="owner". Always pick a scope.
- For threads/polls/scheduling, use the dedicated \`manage-thread\` / \`manage-poll\` / \`manage-schedule\` tools.
- After completing the work, write a short final message to the user describing what you did. Don't list every API call.`;
```

### 4. Force single-target delegation in supervisor (Pattern D, part 2)

[`packages/birmel/src/voltagent/agents/system-prompt.ts:98-100`](packages/birmel/src/voltagent/agents/system-prompt.ts:98):

After the "ALWAYS prefer delegation" sentence (line 98), add:

```
**Delegate to exactly ONE specialist per user message.** Even if a request seems to span multiple specialties, pick the single specialist whose primary tool handles the main action — that specialist can ask follow-ups or chain its own work. Two simultaneous `delegate_task` invocations will produce two visible Discord messages, which is always wrong.
```

### 5. Add post-write verification rule to sub-agents (Pattern F)

[`packages/birmel/src/voltagent/agents/system-prompt.ts:158-171`](packages/birmel/src/voltagent/agents/system-prompt.ts:158):

Append a new section to `SUB_AGENT_BASE` (after the existing "Behavior" block):

```
## Verify before claiming success

After any destructive write — assigning/revoking a role, changing a nickname, editing a channel/role, kicking/banning a member, deleting a message, creating/deleting a webhook — you MUST call the matching read-back tool and confirm the change actually applied before telling the user it worked. Examples:

- After \`manage-member add-role\` → call \`manage-member action=get\` and confirm the new roleId appears in the member's roles.
- After \`manage-member modify\` (nickname) → call \`manage-member action=get\` and confirm \`displayName\` matches what you set.
- After \`manage-role modify\` → call \`manage-role action=get\` and confirm the field you intended to change actually changed.
- After \`manage-channel\` edits → call \`manage-channel action=get\`.

If the read-back shows the change did NOT take effect, tell the user honestly what failed instead of claiming success. A \`success: true\` from a tool only means the API call returned 2xx — it does not always mean the user-visible action you intended happened.
```

### 6. Verification

After edits, run from the worktree root:

```bash
cd packages/birmel
bunx --env-file=.env.test prisma generate   # if not cached
bun --env-file=.env.test test
bun run typecheck
bunx eslint . --fix
```

Then exercise the bot in dev (or in prod after deploy) with these scripted user prompts:

| Prompt                                           | Expected                                                                                                                                            |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@birmel give me the Good Boy role`              | Calls `manage-member action=add-role` with the resolved roleId. Read-back via `manage-member action=get` confirms. Replies with the actual outcome. |
| `@birmel just pick one` (when no role specified) | Asks for the role name OR picks one AND verifies via read-back. Single reply, not two.                                                              |
| `@birmel set my nickname to jerred`              | Calls `manage-member action=modify` with `nickname: "jerred"`. Read-back confirms. Single reply.                                                    |
| `@birmel list my roles`                          | One reply, not two.                                                                                                                                 |

## Out of scope (deferred to follow-up session)

- **Pattern C** (stale context bleeding across turns) — requires deeper investigation of the streaming retry path in [`packages/birmel/src/voltagent/message-stream.ts`](packages/birmel/src/voltagent/message-stream.ts).
- **Pattern E** (`<|endoftext|>` token leak observed on 2026-05-04) — add an OpenAI special-token strip-list to the output sanitizer. Find the sanitizer in `packages/birmel/src/voltagent/agents/hooks.ts` (referenced by every agent as `sanitizeReplayHook`).

## 2026-05-19 follow-up — generalizing the findings (broader audit)

After the first fix shipped, the user asked whether the analysis had been done across the _whole_ tool/agent stack. A broader sweep surfaces several **systemic** issues that A/B/D/F only patched cosmetically. The shipped fix is honest about its scope but is **incomplete** in at least one structurally important way.

### Pattern G — Structural toolset/agent misalignment (HIGH priority)

`moderation-agent` was told (by my fix) "use `manage-member` action `add-role` to grant a role." But [`tool-sets.ts:62-69`](packages/birmel/src/agent-tools/tools/tool-sets.ts:62) does NOT include `memberTools` in `moderationToolSet`. `manage-member` lives only in `serverToolSet`. **The moderation-agent does not actually have the tool I told it to use.** Likely outcomes after deploy:

1. The LLM notices the tool isn't in its bound list and falls back to `manage-role.modify` again (regression).
2. The LLM tries to call `manage-member` anyway and the runtime errors out.
3. The LLM hallucinates the call (Pattern A returns in a new form).

**Fix:** add `...memberTools` to `moderationToolSet`. Member-state mutations (role grants, nickname changes, timeouts) are conceptually moderation actions and belong in the moderation agent's toolset. Keeping member-state read in `server-agent` is fine; member-state **mutations** must be available wherever the prompt tells the agent to make them. Verify all tool counts stay under the 128-tool limit (per the comment at [`tool-sets.ts:3`](packages/birmel/src/agent-tools/tools/tool-sets.ts:3)).

### Pattern H — Sub-agent base lacks the "your text IS the reply" rule (MEDIUM)

My messaging-agent fix put the "don't post duplicates" rule only in [`messaging-agent.ts`](packages/birmel/src/voltagent/agents/specialized/messaging-agent.ts). But [`editor-agent.ts:22-26`](packages/birmel/src/voltagent/agents/specialized/editor-agent.ts:22) explicitly tells the editor agent to use `manage-message` to "format the diff/PR link nicely for the user". With `messageTools` also in `editorToolSet` ([`tool-sets.ts:98`](packages/birmel/src/agent-tools/tools/tool-sets.ts:98)), editor-agent will produce duplicate replies on every PR. **Fix:** move the rule into `SUB_AGENT_BASE` at [`system-prompt.ts:158`](packages/birmel/src/voltagent/agents/system-prompt.ts:158) so all sub-agents inherit it, and remove the contradicting line from editor-agent's guidance.

### Pattern I — "modify" verb is overloaded across 9 tools (MEDIUM)

The role-bug root cause isn't just role/member — `modify` is reused as a bare action name across the entire Discord tool surface, with no per-tool semantic prefix:

| Tool                     | What `modify` means                    |
| ------------------------ | -------------------------------------- |
| `manage-automod-rule`    | edit a rule's keywords/regex           |
| `manage-channel`         | edit channel name/topic/etc            |
| `manage-emoji`           | edit emoji name/roles                  |
| `manage-scheduled-event` | edit event metadata                    |
| `manage-guild`           | edit guild name/region                 |
| `manage-member`          | change nickname (NOT membership)       |
| `manage-role`            | edit role's own props (NOT assignment) |
| `manage-thread`          | edit thread name/archive state         |
| `manage-webhook`         | edit webhook name/avatar               |

Each one is a Pattern-A waiting to happen. The same collision exists for `delete`, `create`, `list`, `get` to a lesser degree. **Fix (systematic):** for every tool with a `modify`/`create`/`delete` action, audit the `action` enum's `.describe()` to spell out WHAT object the verb operates on. Best version: rename action enums to be self-describing, e.g. `manage-role` → actions `list-roles`, `get-role`, `create-role`, `modify-role-definition`, `delete-role`, `reorder-roles`. Verbose but unambiguous; the LLM never has to combine tool-id + bare verb to figure out semantics.

### Pattern J — Server-agent has the same toolset/prompt drift risk

`server-agent` owns `manage-channel` (with `modify`) and `manage-member` (with `modify`). Its guidance ([`server-agent.ts:21-25`](packages/birmel/src/voltagent/agents/specialized/server-agent.ts:21)) says "Use `manage-channel` to list/create/modify channels — prefer 'list' first when answering 'what channels are there'" — same flat phrasing the moderation-agent had before my fix. No callout that `manage-member.modify` = nickname (not role membership). When a request like "change Jerred's nickname" routes here, the agent could pick the wrong action. **Fix:** mirror the moderation-agent treatment — explicit per-tool action mapping in `SERVER_TOOL_GUIDANCE`.

### Pattern K — Handler-side `success: true` doesn't include `verified` (MEDIUM)

[`role-actions.ts`](packages/birmel/src/agent-tools/tools/discord/role-actions.ts), [`member-actions.ts`](packages/birmel/src/agent-tools/tools/discord/member-actions.ts), etc. all return `{ success: true, message, data }` whenever the Discord API returned 2xx. None of them read back to confirm the change actually applied. My Pattern F fix is at the agent prompt level — the LLM is told to verify. But a defense-in-depth fix is at the handler level: after any write, the handler itself re-reads and includes `verified: true | false` plus the observed state in the output. The agent then has structurally rich data to act on, instead of relying on prompt discipline. **Fix:** add `verified` to the output schemas of `handleModifyRole`, `handleAddRole`, `handleRemoveRole`, `handleModifyMember`, `handleModifyChannel`, etc.

### Pattern L — No telemetry catches hallucinated tool claims

When the bot said "missing permissions: ..." for the nickname change on 2026-05-01 with no `tool-manage-member` call in the same agent step, there's no record anywhere. A `onStepFinish` hook (sibling of the existing `sanitizeReplayHook` in [`hooks.ts`](packages/birmel/src/voltagent/agents/hooks.ts)) could heuristically flag steps where the assistant message claims an action result without any matching tool call. Even crude pattern matching ("error:" / "missing permissions" / "done — gave you" without a `tool-` part in the same step) would surface drift in Bugsink for review. Lower priority but cheap.

### What's covered by the already-shipped fix vs. these new findings

| Pattern                     | Shipped fix touches it?                                                      | Still needed                                                                            |
| --------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| A (wrong action)            | Tool descriptions tightened for `manage-role`/`manage-member` only           | Apply the same pattern to all 9 `modify`-having tools (I), self-describing action names |
| B (agent self-knowledge)    | Moderation-agent only                                                        | Same audit on server-agent (J) and the remaining specialists                            |
| D (duplicate replies)       | Supervisor single-delegate rule + messaging-agent send rule                  | Lift the rule into `SUB_AGENT_BASE` (H) so editor-agent inherits it                     |
| F (verification)            | Prompt rule in `SUB_AGENT_BASE`                                              | Defense-in-depth: handler-side `verified` field (K)                                     |
| G (structural toolset bug)  | **Not addressed — the shipped fix references a tool the agent doesn't have** | Add `memberTools` to `moderationToolSet`                                                |
| L (hallucination telemetry) | Not addressed                                                                | New hook in `hooks.ts`                                                                  |

### Risk assessment of deploying the shipped fix as-is

Deploying just the A/B/D/F fixes carries real risk: **the moderation-agent prompt now instructs the LLM to call a tool that isn't bound to it.** The most likely failure mode is regression to the original bug (LLM falls back to `manage-role.modify`). The minimum safe addition is Pattern G (add `memberTools` to `moderationToolSet`) — about 3 lines in `tool-sets.ts` plus a fresh `bun test`. Without G, the shipped fix may make things no better than before.

### Recommended follow-up scope

| Tier             | Patches                                                                              | Effort                | Value                                      |
| ---------------- | ------------------------------------------------------------------------------------ | --------------------- | ------------------------------------------ |
| 1 — must-do      | G (toolset alignment)                                                                | ~3 lines + tests      | Makes the shipped fix actually work        |
| 2 — should-do    | H (lift rule into SUB_AGENT_BASE), J (server-agent guidance mirror)                  | ~30 lines             | Closes the loophole the shipped fix opened |
| 3 — systematic   | I (audit all `modify` tools, optionally rename actions), K (handler-side `verified`) | several hundred lines | Eliminates Pattern A as a class            |
| 4 — nice-to-have | L (hallucination telemetry), C and E from the deferred list                          | scoped, exploratory   | Diagnostic value                           |

### Honest accounting of audit completeness

What I have NOT examined even now:

- `voltagent_memory_steps` (99 rows) and `voltagent_vectors` (115 rows) tables — would show the full agent reasoning trail, possibly revealing more hallucination patterns.
- `birmel.db` (Prisma DB) — activity/elections/birthdays data; might surface scheduler bugs.
- Past **resolved** Bugsink issues' actual event payloads (only their titles were checked).
- The other 13 Discord tool handler files for the same pattern-K shape.
- The voltagent supervisor/sub-agent runtime in `@voltagent/core` to understand whether the multi-target `delegate_task` is supervisor-side opt-in or a runtime default.
- `packages/birmel/tests/` to know which paths have coverage and which don't.

A truly complete audit would also exercise the bot against a scripted conversation matrix in dev to catch interactions Pattern-A-through-L don't cover.

## Tier 1+2+3 implementation plan (approved)

The user picked the full systematic fix. The work breaks into 5 buckets, executable in order. Each bucket is independently verifiable.

### Bucket 1 — Pattern G: structural toolset alignment (unblocks shipped fix)

**File:** [`packages/birmel/src/agent-tools/tools/tool-sets.ts:62-69`](packages/birmel/src/agent-tools/tools/tool-sets.ts:62)

Add `memberTools` to `moderationToolSet`. Member-state mutations (nickname change, add-role, remove-role) are moderation actions and belong wherever the moderation-agent operates.

```ts
export const moderationToolSet = [
  ...moderationTools,
  ...roleTools,
  ...memberTools, // ← add
  ...automodTools,
  ...webhookTools,
  ...inviteTools,
  ...emojiTools,
];
```

Verify the resulting tool count stays under 128 (the limit referenced in the comment at line 3) — `moderationToolSet` was ~25 tools before, this adds 1 more.

### Bucket 2 — Pattern H: sub-agent "text IS the reply" rule lives in the base prompt

**File:** [`packages/birmel/src/voltagent/agents/system-prompt.ts:158-171`](packages/birmel/src/voltagent/agents/system-prompt.ts:158) — append a paragraph to `SUB_AGENT_BASE`:

```
## Your text output is the reply — do not double-post

Your final text output is automatically sent to the channel that triggered this task. Do NOT use a message-posting tool (manage-message action="send"/"reply"/"edit") to also post into the same channel — you will produce a duplicate. Only call manage-message to post into a DIFFERENT channel (e.g. cross-posting an announcement, sending a DM, posting to a thread you just created).
```

**File:** [`packages/birmel/src/voltagent/agents/specialized/messaging-agent.ts`](packages/birmel/src/voltagent/agents/specialized/messaging-agent.ts) — remove the now-duplicated first two bullets from `MESSAGING_TOOL_GUIDANCE`; keep the operational bullets.

**File:** [`packages/birmel/src/voltagent/agents/specialized/editor-agent.ts:22-26`](packages/birmel/src/voltagent/agents/specialized/editor-agent.ts:22) — remove the line `"- Reply tools are also available so you can format the diff/PR link nicely for the user after the work is done."` because it directly contradicts the new base rule. The editor-agent's final text output is the formatted PR link reply.

### Bucket 3 — Pattern J: server-agent guidance mirror

**File:** [`packages/birmel/src/voltagent/agents/specialized/server-agent.ts:21-25`](packages/birmel/src/voltagent/agents/specialized/server-agent.ts:21) — rewrite `SERVER_TOOL_GUIDANCE` with the same per-tool action specificity used in the new moderation-agent guidance:

```ts
const SERVER_TOOL_GUIDANCE = `- Use \`manage-guild\` for guild metadata (action 'get-info', 'get-owner', 'modify' to edit guild name/region/icon, 'get-audit-logs').
- Use \`manage-channel\` for channel operations:
  - action 'list' to enumerate channels (prefer first when answering "what channels are there").
  - action 'get'/'modify'/'create'/'delete' to inspect or edit channel definitions.
  - action 'set-permissions' to grant/revoke channel permissions.
- Use \`manage-member\` for member lookups:
  - action 'get' to read a member's roles/displayName/joinedAt.
  - action 'search'/'list' to find members.
  - action 'modify' edits the member's NICKNAME only — not their role membership.
  - actions 'add-role'/'remove-role' grant or revoke a role to/from a specific member.
- Use \`sqlite-query\` for analytical questions ("who has the most karma", "when was X last seen"). Read-only — no INSERT/UPDATE/DELETE.
- Always answer with the data you fetched, not from prior knowledge.`;
```

### Bucket 4 — Pattern I: systematic action-enum disambiguation (7 remaining tools)

For each tool with a `modify` action, update the `action` field's `.describe()` to explain what each action operates on. Roles and members are already done; remaining:

| File                                                                       | Tool id                  | Per-action description to add                                                                                                     |
| -------------------------------------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| [`automod.ts`](packages/birmel/src/agent-tools/tools/discord/automod.ts)   | `manage-automod-rule`    | list/get/create/modify (edit rule keywords/regex)/delete/toggle                                                                   |
| [`channels.ts`](packages/birmel/src/agent-tools/tools/discord/channels.ts) | `manage-channel`         | list/get/create/modify (edit channel name/topic/category)/delete/reorder/set-permissions (edit a channel's permission overwrites) |
| [`emojis.ts`](packages/birmel/src/agent-tools/tools/discord/emojis.ts)     | `manage-emoji`           | list/create/modify (rename or change role restrictions)/delete                                                                    |
| [`events.ts`](packages/birmel/src/agent-tools/tools/discord/events.ts)     | `manage-scheduled-event` | list/create/modify (edit event metadata)/delete/get-users                                                                         |
| [`guild.ts`](packages/birmel/src/agent-tools/tools/discord/guild.ts)       | `manage-guild`           | get-info/get-owner/modify (edit guild name/region)/set-icon/set-banner/get-audit-logs                                             |
| [`threads.ts`](packages/birmel/src/agent-tools/tools/discord/threads.ts)   | `manage-thread`          | create-from-message/create-standalone/modify (edit name or archived/locked state)/add-member/get-messages                         |
| [`webhooks.ts`](packages/birmel/src/agent-tools/tools/discord/webhooks.ts) | `manage-webhook`         | list/create/modify (edit webhook name/avatar)/delete/execute                                                                      |

Pattern: change `.describe("The action to perform")` to a multi-line string listing each enum value with a short clarification. This is the same shape used in the already-applied `manage-role` fix.

### Bucket 5 — Pattern K: handler-side read-back in `data`

For the four highest-risk write handlers, change the success path to **re-read and return the fresh state in `data`**, not just `success: true`. The agent then sees the actual post-mutation state instead of trusting a boolean.

| Handler                         | File                                                                                   | Read-back call                                                                  |
| ------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `handleModifyRole`              | [`role-actions.ts`](packages/birmel/src/agent-tools/tools/discord/role-actions.ts)     | re-fetch the role and return its current name/color/hoist/mentionable in `data` |
| `handleAddRole`                 | [`member-actions.ts`](packages/birmel/src/agent-tools/tools/discord/member-actions.ts) | re-fetch the member and return their current roles array in `data.roles`        |
| `handleRemoveRole`              | same                                                                                   | same                                                                            |
| `handleModifyMember` (nickname) | same                                                                                   | re-fetch the member and return current `displayName` in `data`                  |

Output schema changes: the existing `outputSchema` already has `data` as a union — add the post-mutation shape and ensure callers handle it. Tests under `packages/birmel/tests/` need updating to mock the read-back. The agent's verify-before-claim prompt rule now has structural backing — it can quote the read-back state directly.

### Verification

After all 5 buckets:

```bash
cd packages/birmel
bun run typecheck
bun run test
bunx eslint . --fix
```

Bot-level test prompts (run after deploy in the Glitter Boys channel):

| Prompt                                                 | Expected behavior                                                                                                                                 |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@birmel give me the Good Boy role`                    | moderation-agent calls `manage-member action=add-role`, handler returns post-state with new role in `data.roles`, bot reports it. One reply only. |
| `@birmel set my nickname to jerred`                    | moderation-agent calls `manage-member action=modify`, handler returns updated `displayName` in `data`, bot reports it. One reply.                 |
| `@birmel rename the Good Boy role to "Doggo"`          | moderation-agent uses `manage-role action=modify`; bot reports the new name from the handler's read-back. No member roles touched.                |
| `@birmel make jerred lowercase` (an editor-agent path) | editor-agent produces a single reply via its text output, no `manage-message` double-post.                                                        |
| `@birmel list my roles`                                | server-agent calls `manage-member action=get`, returns one reply.                                                                                 |

### Effort estimate

- Bucket 1: ~5 minutes (3-line change + test run).
- Bucket 2: ~20 minutes (3 files, text rewrites).
- Bucket 3: ~10 minutes (1 file, text rewrite).
- Bucket 4: ~45 minutes (7 files, text rewrites).
- Bucket 5: ~90 minutes (4 handlers + schema + tests).

Total ~3 hours of focused work, well under one session.

### Critical files (consolidated)

- [`packages/birmel/src/agent-tools/tools/tool-sets.ts`](packages/birmel/src/agent-tools/tools/tool-sets.ts) — Bucket 1
- [`packages/birmel/src/voltagent/agents/system-prompt.ts`](packages/birmel/src/voltagent/agents/system-prompt.ts) — Bucket 2 base rule
- [`packages/birmel/src/voltagent/agents/specialized/messaging-agent.ts`](packages/birmel/src/voltagent/agents/specialized/messaging-agent.ts) — Bucket 2 cleanup
- [`packages/birmel/src/voltagent/agents/specialized/editor-agent.ts`](packages/birmel/src/voltagent/agents/specialized/editor-agent.ts) — Bucket 2 cleanup
- [`packages/birmel/src/voltagent/agents/specialized/server-agent.ts`](packages/birmel/src/voltagent/agents/specialized/server-agent.ts) — Bucket 3
- [`packages/birmel/src/agent-tools/tools/discord/automod.ts`](packages/birmel/src/agent-tools/tools/discord/automod.ts), [`channels.ts`](packages/birmel/src/agent-tools/tools/discord/channels.ts), [`emojis.ts`](packages/birmel/src/agent-tools/tools/discord/emojis.ts), [`events.ts`](packages/birmel/src/agent-tools/tools/discord/events.ts), [`guild.ts`](packages/birmel/src/agent-tools/tools/discord/guild.ts), [`threads.ts`](packages/birmel/src/agent-tools/tools/discord/threads.ts), [`webhooks.ts`](packages/birmel/src/agent-tools/tools/discord/webhooks.ts) — Bucket 4
- [`packages/birmel/src/agent-tools/tools/discord/role-actions.ts`](packages/birmel/src/agent-tools/tools/discord/role-actions.ts), [`member-actions.ts`](packages/birmel/src/agent-tools/tools/discord/member-actions.ts) — Bucket 5

## Critical files

- [`packages/birmel/src/agent-tools/tools/discord/roles.ts`](packages/birmel/src/agent-tools/tools/discord/roles.ts) — tool description fix
- [`packages/birmel/src/agent-tools/tools/discord/members.ts`](packages/birmel/src/agent-tools/tools/discord/members.ts) — tool description fix
- [`packages/birmel/src/voltagent/agents/specialized/moderation-agent.ts`](packages/birmel/src/voltagent/agents/specialized/moderation-agent.ts) — guidance rewrite
- [`packages/birmel/src/voltagent/agents/specialized/messaging-agent.ts`](packages/birmel/src/voltagent/agents/specialized/messaging-agent.ts) — tighten send-rule
- [`packages/birmel/src/voltagent/agents/system-prompt.ts`](packages/birmel/src/voltagent/agents/system-prompt.ts) — supervisor single-delegate rule + sub-agent verify rule

## Appendix: status snapshot at start of session

The original status report from earlier in the session is preserved here for context. Pod health, deploy state, and Bugsink summary remain accurate.

### Recent activity (last 30 days)

| Date              | Commit      | Theme                                                                |
| ----------------- | ----------- | -------------------------------------------------------------------- |
| 2026-05-13 (plan) | —           | Bugsink-cleanup plan: empty-stream retry, Prisma generate in image   |
| 2026-05-03        | `309cf83d2` | Ship spans to Tempo                                                  |
| 2026-05-02        | `916f2d30b` | Restore Bugsink delivery + scheduler resilience                      |
| 2026-05-01        | `94d184325` | VoltAgentObservability fix (duplicate API registration spam)         |
| 2026-05-01        | `2ed289f9f` | Stop silent typing cursor on concurrent pings/tool throws            |
| 2026-04-26        | `e124c92ea` | Default Sentry tracesSampleRate to 0 for Bugsink                     |
| 2026-04-25        | `eb141f50e` | Rename mastra/tools → agent-tools/tools                              |
| 2026-04-22        | various     | Dep bumps (@voltagent/core, @opentelemetry, discord-player-youtubei) |

### Production state

- Deployed image: `shepherdjerred/birmel: 2.0.0-2455@sha256:5b5e50…` ([versions.ts:115](packages/homelab/src/cdk8s/src/versions.ts:115)) — past the broken `2.0.0-2370` from the May-13 plan caveats.
- Pod `birmel-6fdc8c5bd-9plww` Running 2d16h, scheduler healthy (birthday/activity ticks every minute).
- Bugsink project id=7: **0 unresolved**, 4 historical issues all resolved, 55 events stored.
- The May-13 Bugsink-cleanup plan can be flipped to `Status: Complete` and `git mv`'d to `packages/docs/archive/completed/` — separate from this work.

### Open PRs

- [#823](https://github.com/shepherdjerred/monorepo/pull/823) — routine image bump (caddy-s3proxy, obsidian-headless), not Birmel-specific.

## Session Log — 2026-05-17 / 2026-05-19

### Done (round 1, 2026-05-17 — A/B/D/F)

- Pulled `/app/data/mastra-memory.db` off prod pod and analyzed all 137 messages.
- Identified 6 failure patterns A–F; shipped fixes for A/B/D/F across 5 source files (+30/-10).
- Verification clean: typecheck, 108-pass test suite, eslint.

### Done (round 2, 2026-05-19 — systematic generalization, Tier 1+2+3)

User pushed back: had I generalized the findings to the whole stack? Broader audit surfaced patterns G–L. Tier 1+2+3 shipped across 17 files (+206/-44):

- **Bucket 1 (Pattern G):** added `memberTools` to `moderationToolSet` in [tool-sets.ts](packages/birmel/src/agent-tools/tools/tool-sets.ts) so the moderation-agent actually has the `manage-member.add-role` tool the round-1 prompt fix referenced. Updated `getAgentDescription` and supervisor's specialist list to reflect the broader moderation scope.
- **Bucket 2 (Pattern H):** lifted the "your final text IS the reply — do not double-post" rule from messaging-agent into `SUB_AGENT_BASE` in [system-prompt.ts](packages/birmel/src/voltagent/agents/system-prompt.ts) so all 6 specialists inherit it. Removed the duplicate bullets from messaging-agent and the contradicting "reply tools available" line from editor-agent.
- **Bucket 3 (Pattern J):** rewrote `SERVER_TOOL_GUIDANCE` in [server-agent.ts](packages/birmel/src/voltagent/agents/specialized/server-agent.ts) with the same per-tool, per-action specificity used in the round-1 moderation-agent fix.
- **Bucket 4 (Pattern I):** added per-action disambiguation `.describe()` strings to 7 more tools — [automod.ts](packages/birmel/src/agent-tools/tools/discord/automod.ts), [channels.ts](packages/birmel/src/agent-tools/tools/discord/channels.ts), [emojis.ts](packages/birmel/src/agent-tools/tools/discord/emojis.ts), [events.ts](packages/birmel/src/agent-tools/tools/discord/events.ts), [guild.ts](packages/birmel/src/agent-tools/tools/discord/guild.ts), [threads.ts](packages/birmel/src/agent-tools/tools/discord/threads.ts), [webhooks.ts](packages/birmel/src/agent-tools/tools/discord/webhooks.ts). Each `modify` action now spells out exactly what it modifies.
- **Bucket 5 (Pattern K):** added defense-in-depth read-back to the four highest-risk write handlers. [member-actions.ts](packages/birmel/src/agent-tools/tools/discord/member-actions.ts) (`handleModifyMember`/`handleAddRole`/`handleRemoveRole`) and [role-actions.ts](packages/birmel/src/agent-tools/tools/discord/role-actions.ts) (`handleModifyRole`) now `guild.fetch(..., { force: true })` after every write and set `verified: true` only when the post-write state matches the request. Output schemas in [members.ts](packages/birmel/src/agent-tools/tools/discord/members.ts) and [roles.ts](packages/birmel/src/agent-tools/tools/discord/roles.ts) expose the `verified` field. Updated the sub-agent prompt's "Verify before claiming success" section to instruct the LLM to check `verified` first and fall back to read-back tool calls for other write actions.
- Verification clean: typecheck, 108-pass test suite, eslint after a small refactor (`verifyRoleEdit` helper to drop complexity from 22→under 20, swapped deprecated `Role.color` for `Role.hexColor` comparison).

### Remaining

- Open PR → image build → deploy via Dagger/GitOps. The round-1 fix and round-2 fix should ship together so we don't regress through the Pattern G window.
- After deploy, run scripted verification prompts in the Glitter Boys channel: "give me the Good Boy role", "set my nickname to jerred", "rename the Good Boy role to Doggo", "list my roles". Confirm:
  - Single reply per prompt.
  - Correct tool selection in traces.
  - `verified: true` in tool output (visible in logs/Bugsink traces).
  - Bot response text quotes the read-back state, not just "done".
- Patterns C (stale-context bleed-through in retry path) and E (`<|endoftext|>` token leak) and L (telemetry for hallucinated tool claims) remain out of scope.

### Caveats

- The 2026-05-17 incident may have renamed role id `1465244917533118618` to "Good Boy" / `#ffd700`. Check the server's role settings; restore manually if it was previously something else.
- The handler-side read-back adds ~1 extra Discord API call per destructive write. Trade-off accepted: catches Pattern A failures structurally even when prompt discipline lapses.
- Discord's `force: true` re-fetch hits the API directly — should reflect the post-write state immediately, but if Discord's own backend has eventual consistency on edits, `verified: false` could be a false negative. Risk seems low for the four operations we instrumented (roles/nickname are guild-state writes that are immediately consistent). Worth monitoring after deploy.
- The new "Pattern G fix" (memberTools in moderationToolSet) means BOTH `server-agent` and `moderation-agent` now have `manage-member`. The supervisor prompt steers role-grant requests to moderation-agent and member-lookup requests to server-agent; the single-delegate rule from round-1 prevents simultaneous dual-routing. If we see new duplicate replies post-deploy, look here first.
