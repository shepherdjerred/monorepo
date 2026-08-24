---
title: Diagnose a missing notification
description: Work out why a match did not post — in the order that finds the cause fastest.
sidebar:
  order: 9
---

Work down this list in order. Each step rules out a whole class of cause, so
skipping ahead usually wastes time.

## 1. Confirm how long you have actually waited

Scout is not instant, and most "missing" notifications are early:

- A **pre-match** card appears within about 30 seconds of the game starting.
- A **post-match** recap appears within about a minute of the game ending — and
  the game has to be _finished_, not just over for the tracked player. A player
  who dies at 20 minutes gets their recap when the game ends, not when they die.

If it has been under two minutes, wait.

## 2. Confirm Scout is running

Run `/status` in the server. It confirms Scout is online and reports gateway
latency.

If `/status` does not respond at all, Scout is not reachable from that server —
nothing further down this list will help.

## 3. Confirm the subscription exists and posts where you think

Run `/list`. It shows tracked players and the channel each posts to.

Two common surprises:

- The subscription is on a **different channel** than the one you were watching.
- The player is tracked under an **alias you did not expect**, so you scrolled
  past it.

`/list` shows at most 25 subscriptions. If the server has more, check the
**Subscriptions** tab in the dashboard instead.

## 4. Check mute

Open **Subscriptions** in the dashboard. A muted subscription posts nothing at
all and gives no other symptom. Unmute it.

## 5. Check the queue filter

Still on that row, open **Filters**.

- If it reads **All queues**, the filter is not the cause.
- Otherwise, confirm the queue that was actually played is ticked. Ranked flex
  is not solo; ARAM is not ARAM Clash.

:::caution
If the missing game was a **brand-new game mode**, a queue filter is the likely
cause. Scout drops matches whose queue it does not yet recognize from any
_filtered_ subscription, while unfiltered subscriptions post them normally.
Clearing the filter on that subscription restores the notifications.
:::

## 6. Check Scout's channel permissions

In Discord, check Scout's permissions on the destination channel. It needs:

| Permission    | Without it                      |
| ------------- | ------------------------------- |
| View Channel  | nothing posts                   |
| Send Messages | nothing posts                   |
| Embed Links   | embeds fail                     |
| Attach Files  | recap and chart **images** fail |

Attach Files is the one that catches people: pre-match text may appear while the
recap image silently fails, which reads like "post-match is broken".

Check both the channel overwrites and the role permissions — a channel-level
deny overrides a server-level allow.

## 7. Check the account, not just the player

Open **Players** and the player in question. Confirm the Riot account listed is
the one they actually played on. A smurf that was never added is invisible to
Scout.

Add it as an additional account on the same player — see [Add and organize
tracked players](/docs/how-to/add-players/).

## 8. Account for games played before you tracked them

When a subscription is created, Scout records where that account's history
currently stands so it does not flood your channel with old games. Matches
finished **before** you ran `/track` will not post notifications.

Scout quietly imports up to the 20 most recent games for Explore, ScoutQL
reports, AI review context, and the player profile. Those older games may appear
in history after a few minutes, but they never produce recaps, betting results,
earnings, or other automatic messages. Only games completed after the import's
snapshot can notify.

## 9. Check the audit log

Open **Audit**. If a subscription was deleted, moved, muted, or filtered, it is
recorded there with who did it. On a server with several admins this is
frequently the whole answer.

## Reports specifically

If a _scheduled report_ did not post:

1. Confirm the report is **enabled**.
2. Check its **run history** — a run that completed with zero rows means the
   query matched nothing, not that delivery failed.
3. Confirm the schedule's **timezone**. A report set to a timezone twelve hours
   away fires at a time that looks wrong locally.
4. Confirm Scout has **Attach Files** in the report's channel.

Freshly finished games are staged for reports immediately. A newly tracked
account can still take a few minutes to appear in a server-scoped report while
Scout publishes the account mapping and imported history together.

## Still missing

Collect these before asking for help — they are what makes an answer possible:

- the server, the player alias, and the destination channel,
- roughly when the match ended,
- the queue that was played,
- whether `/status` responds and what `/list` shows.

## Related

- [How Scout finds and reports matches](/docs/explanation/how-scout-works/)
- [Route notifications to the right channels](/docs/how-to/route-notifications/)
