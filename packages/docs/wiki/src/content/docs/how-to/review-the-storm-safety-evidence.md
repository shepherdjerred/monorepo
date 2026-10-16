---
title: How to review The Storm safety evidence
description: Inspect a publication decision, export private evidence, and verify recovery without exposing player messages.
---

Use the staff review queue to find a decision, then inspect its private evidence reference.

## 1. Find the decision

Run `/escalations` or `/agent decisions <player>` with the staff permission.
Safety rows contain a submission UUID rather than a copy of private text.
Use the permissions and policy in [The Storm agent reference](/reference/the-storm-agent/).

For a complaint without a reference, search the authenticated bridge:

```bash
toolkit mc evidence search --target live --player Example --since 2026-10-01T00:00:00Z --limit 100
toolkit mc evidence show <submission-uuid> --target live
```

Search and show print private JSON. Use a private terminal and keep results out of public issues and screenshots.
`/safety search <player> [words]` returns results only to authorized in-game staff; console output contains no private rows.

The command contract lives in the [toolkit reference source](https://github.com/shepherdjerred/monorepo/blob/main/packages/toolkit/README.md).

## 2. Check publication and attribution

Compare the original attempt, structured components, individual window verdicts, final decision and publication receipt.
An allowed decision alone does not prove delivery: a disconnect, changed recipient, stale item or protection listener can prevent publication.

For advertising, inspect the surrounding conversation and warning receipt.
Friendly requested invitations are allowed. A model signal alone does not justify a ban.
For reported abuse, distinguish the reporter's quotation from the original author.
Saved-content snapshots identify a location and observation; they do not identify the creator.

For a Grim finding, inspect the client, ping, location, movement state, effects and gameplay context.
Compare it with the arena's permitted mechanics before taking action.
Use CoreProtect for the matching block or item history and a scoped rollback.

The admission and journal implementation is owned by the [Storm modules](https://github.com/shepherdjerred/monorepo/tree/main/packages/the-storm/plugin/modules).

## 3. Record the human decision

Use `/agent endorse <decision-id>` for a correct row, or `/agent overturn <decision-id>` for an incorrect row.
An overturn lifts its mute. Use `/unmute <player>` when a separate staff mute needs reversal.
Record the evidence UUID on any private incident ticket. Keep raw DMs in the evidence archive.

An unavailable check is not misconduct. Repair service access or the contract mismatch, then ask the player to submit again.
Restart recovery does not replay an uncertain publication.

## 4. Export or verify recovery

Export a bounded incident window to a new private file:

```bash
toolkit mc evidence export --target live --player Example --since 2026-10-01T00:00:00Z --until 2026-10-02T00:00:00Z --output incident-private.jsonl
```

The exporter refuses overwrite and creates an owner-only file.
If export fails, treat the remaining file as partial and private; retry with a new path.

To verify a restore, start an isolated sandbox from the selected backup through the existing recovery workflow.
Repeat search and show against its explicit sandbox target. Compare known allowed, blocked and private-message receipts.
Confirm that interrupted submissions have an interruption receipt and were not automatically published.
Never use the live target to test destructive recovery.

Retention and restore ownership are declared in the [server source](https://github.com/shepherdjerred/monorepo/tree/main/packages/the-storm/server).

## Related

- [The Storm AI staff](/explanation/the-storm-ai-staff/)
- [Operate The Storm with the agent harness](/how-to/operate-the-storm-with-the-agent-harness/)
