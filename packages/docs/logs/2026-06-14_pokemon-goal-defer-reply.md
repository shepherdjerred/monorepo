# /goal slash command timing out — defer the reply

## Status

Complete

## Symptom

In Discord, `/goal <objective>` returned `The application did not respond` and never produced a real reply.

## Root cause

`makeGoal` in `packages/discord-plays-pokemon/packages/backend/src/discord/slashCommands/commands/goal.ts` called `interaction.reply(...)` only after `goalManager.startGoal(...)` resolved. `startGoal` does enough async work that it routinely blows past Discord's 3-second interaction-ack window:

- `hasCodexCredential` filesystem probe
- `prepareRuntimeTools` (writes/refreshes the helper bin dir)
- `Bun.write` to materialize the screenshot dir
- `Bun.spawn` for the Codex subprocess
- `persistState` JSON write

If anything in that chain took more than ~3s (cold filesystem, slow spawn, IO contention) Discord stopped waiting for an ack and surfaced the generic "did not respond" failure.

## Fix

Defer the reply as soon as we've read the option, then use `editReply` once `startGoal` returns. Buys the bot the full 15-minute window Discord gives a deferred interaction.

```ts
const goal = interaction.options.getString("goal", true);
await interaction.deferReply();
const result = await goalManager.startGoal({ goal, ... });
await interaction.editReply({
  content: result.content,
  allowedMentions: result.ephemeral ? undefined : { users: [interaction.user.id] },
});
```

The synchronous "goal mode disabled" early-return still uses `interaction.reply({ ephemeral: true })` — no defer needed there.

## Behavior change

`deferReply()` commits to ephemerality up front. The happy-path "Goal started" reply has to be public so the requester gets pinged, so the deferred reply is non-ephemeral. Side effect: the error result paths inside `startGoalLocked` (`busy`, `missing_credential`, `locked`) are now visible to the whole channel instead of being ephemeral. These are useful state for everyone (someone else's goal is locked, credentials are missing on the host) so this is acceptable. The early-return `disabled` and `invalid` paths return _before_ defer is reached and stay ephemeral.

## Verification

- `bun run typecheck` in `packages/discord-plays-pokemon/packages/backend` — clean.
- `bunx eslint src/discord/slashCommands/commands/goal.ts` — clean.
- No slash-command-handler tests existed for this file; goal-manager / e2e tests are unaffected.

## Session Log — 2026-06-14

### Done

- Patched `packages/discord-plays-pokemon/packages/backend/src/discord/slashCommands/commands/goal.ts` to defer the reply before `goalManager.startGoal` and edit it on completion.
- Opened PR against `main` from `fix/pokemon-goal-defer-reply`.

### Remaining

- Watch the next live `/goal` invocation to confirm Discord shows "Pokébot Helper is thinking…" then the real reply (rather than the timeout error).

### Caveats

- Error replies that used to be ephemeral (`busy`, `missing_credential`, `locked`) now post publicly because deferred replies can't switch ephemerality. Revisit if that becomes a problem.
