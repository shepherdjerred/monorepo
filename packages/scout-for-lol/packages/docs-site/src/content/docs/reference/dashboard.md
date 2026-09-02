---
title: Dashboard reference
description: Every section of the Scout web dashboard, what it contains, and which permission it requires.
sidebar:
  order: 2
---

The dashboard is served at `https://scout-for-lol.com/app/`. Signing in uses
Discord OAuth and the session is a cookie. Subscription, player, account, and
permission changes are recorded in the audit log; see [Audit](#audit) for what
the log does and does not cover.

A beta deployment of the same dashboard runs at
`https://beta.scout-for-lol.com/app/` against separate data.

## Top level

| Route                  | Contents                                          |
| ---------------------- | ------------------------------------------------- |
| `/app/`                | Server picker — the servers you can manage        |
| `/app/welcome`         | Guided onboarding wizard                          |
| `/app/installed`       | Landing page after adding Scout to a server       |
| `/app/explore`         | Persistent Explore conversations and dare drawers |
| `/app/g/<server id>/…` | The workspace for one server                      |

## Explore

Explore keeps private, branching conversations over Scout's recorded match
corpus. When Dare v2 is enabled for one of your Bryan Bucks servers, the header
also opens searchable **My Dares** and **Guild Dares** drawers.

**My Dares** includes your private unfunded drafts and every visible funded
contract. **Guild Dares** includes funded contracts in servers you currently
share; it never exposes another member's draft. A dare card shows its stable ID,
revision, lifecycle state, explicit same-game or cross-game meaning, targets,
queue and time bounds, current pot, evidence progress, and reproducible proof
after settlement.

Draft owners can validate, historically preview, revise, or delete a draft.
The advanced editor exposes the typed contract plan and generated ScoutQL with
diagnostics, semantic explanation, and a meaning diff before revision. Funding,
acceptance, decline, contribution, and cancellation first create a revision-
bound, single-use confirmation; merely opening or sharing a card never moves BB.

## Server workspace sections

Each section requires the corresponding `read` permission; a section you cannot
read is not shown.

| Section           | Route           | Contents                                                               |
| ----------------- | --------------- | ---------------------------------------------------------------------- |
| **Subscriptions** | `subscriptions` | Every player-to-channel delivery, with filters, mute, move, and remove |
| **Players**       | `players`       | Tracked players, their Riot accounts, and their Discord links          |
| **Competitions**  | `competitions`  | Competitions, participants, and standings                              |
| **Reports**       | `reports`       | Saved ScoutQL reports, schedules, and run history                      |
| **Audit**         | `audit`         | Who changed what, and when                                             |
| **Access**        | `access`        | Who has Scout access, and what they hold                               |

Every page also offers a **Setup guide** link and a **Change guild** link in
the header.

## Players

- Search by alias.
- **+ Track player** adds a player with a channel, region, Riot ID, and player
  name, optionally linking a Discord user and restricting queues up front.
- **My linked player** jumps to the player linked to your own Discord account.
- Add further Riot accounts to an existing player.
- Rename, merge, and delete players.
- Link and unlink a Discord user.
- Edit, transfer, and delete individual accounts.

## Subscriptions

- One row per player-to-channel delivery, showing its Riot accounts, channel,
  and current queue filters.
- **+ Add subscription** adds a channel for a player.
- **Edit filters** sets a queue filter on one subscription; **Set filters for a
  channel** applies one to every subscription in a channel.
- Mute and unmute.
- Move a subscription to another channel.
- Remove a subscription.

## Competitions

- Create from a preset or from scratch: title, description, announcement
  channel, visibility, max participants, criteria, and dates.
- Manage participants for invite-only competitions.
- View standings, **Refresh standings**, edit, and cancel. Status shows as a
  badge derived from the dates.

Creating and editing are gated on `competitions:create` and
`competitions:update` before the form opens.

## Reports

- Start from a categorized preset library, or write ScoutQL with editor
  completion and inline diagnostics.
- **Live preview** re-runs the query against real data as you type, rendering
  the chart image and the underlying rows, plus rows returned and scanned.
- **Enabled only** filters the list; a **Source** column separates
  system-managed reports from user-written ones.
- Set title, description, destination channel, schedule, and timezone, with a
  **Next 3 runs** preview of the schedule.
- Run on demand, and read per-run status, duration, and row counts.
- Enable and disable without deleting.

Creating and editing are gated on `reports:create` and `reports:update`.

## Audit

A record of subscription, player, account, and permission changes — the actor,
the action, and the time. Includes changes made from Discord commands, not only
dashboard changes.

Competition and report mutations are not audited yet: creating, editing,
cancelling, and deleting them leaves no entry in this log.

## Access

Grant and revoke Scout permissions, by role preset or individual permission. See
the [permission reference](/docs/reference/permissions/).

## Related

- [Discord commands](/docs/reference/discord-commands/)
- [Why Scout is web-first](/docs/explanation/web-first/)
