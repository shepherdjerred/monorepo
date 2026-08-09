---
title: Run and manage competitions
description: Choose criteria that measure what you want, control who takes part, adjust a running competition, and cancel one cleanly.
sidebar:
  order: 5
---

A competition ranks tracked players against each other over a window, posts
updates to a channel while it runs, and announces final standings when it ends.
Scout starts and ends it on its own from the dates you set.

## Choose criteria that measure what you mean

Criteria decide what "winning" is. Picking the wrong one produces a leaderboard
nobody trusts.

- **Most games played** — rewards volume. Good for a server-wide activity push,
  bad if you want to reward playing well.
- **Highest rank** — peak rank reached, solo or flex only. Favors whoever was
  already highest; use it when the point is bragging rights, not improvement.
- **Most rank climb** — LP gained across the window, solo or flex only. This is
  the one that lets a Silver player beat a Diamond player, so it is usually the
  better "season race".
- **Most wins** — wins in a queue you choose.
- **Most wins on a champion** — wins on one specific champion, optionally
  restricted to a queue. The basis of one-trick challenges.
- **Highest win rate** — needs a minimum game count, which defaults to 10. Never
  run this without a sensible floor or someone wins on a 1-0 record.

Every criteria type and the queues each accepts are listed in the [competition
reference](/docs/reference/competitions/).

## Control who takes part

Set **Visibility** when you create it:

- **SERVER_WIDE** — every tracked player is in automatically. No admin work, and
  nobody can opt out.
- **OPEN** — players choose to join. Use when taking part should be deliberate.
- **INVITE_ONLY** — you pick the participants. Use for a subset, like one team.

For `INVITE_ONLY`, open the competition and manage its participants directly.
Invited players sit at `INVITED` until they join, then become `JOINED`; someone
who drops out is `LEFT` and stops accruing.

You can also cap the field with **Max participants**.

## Set the window

Choose either:

- **Fixed dates** — an explicit start and end.
- **Season** — the competition follows a League season's boundaries.

Use a season for a climb race that should end when the season does; use fixed
dates for anything shorter.

## Let the lifecycle drive it

Scout checks competitions every fifteen minutes and, from that check:

- announces the start when the start date arrives,
- posts standings updates to the announcement channel while it runs,
- posts final standings and closes it when the end date passes.

Status is derived from the dates rather than stored, so correcting a date
immediately corrects whether the competition is upcoming, running, or finished.

## Adjust a running competition

Open it and choose **Edit** to change the title, description, announcement
channel, or dates.

Changing the criteria of a running competition re-ranks it against the new
measure — reasonable when you set it up wrong on day one, disruptive if people
have been playing toward the old one for a week. Prefer cancelling and starting
a clean competition in that case.

![A competition detail page with an ACTIVE badge, details, schedule, criteria, standings, and participants.](../../../assets/dashboard-competition.png)

## Force a leaderboard refresh

If standings look stale after games that should have counted, choose **Refresh
standings** on the competition page rather than waiting for the next
fifteen-minute pass.

If the games are missing entirely rather than just late, the problem is
upstream: see [Diagnose a missing
notification](/docs/how-to/troubleshoot-notifications/).

## Cancel one

Open the competition and choose **Cancel**. It stops accruing and stops posting
updates. Cancel rather than delete when you want the record of it to remain.

## Build a leaderboard the criteria cannot express

The built-in criteria are deliberately a short list. For anything else — damage,
vision, CS per minute, teammate groups, champion-specific splits — write a
report instead:

```sql
select games, win_rate, kda
from match_participants
where queue in (solo)
and games >= 10
group by player
order by kda desc
render leaderboard
```

See [Build your first scheduled report](/docs/tutorials/first-report/).

## Related

- [Competition reference](/docs/reference/competitions/)
- [Run your first competition](/docs/tutorials/first-competition/)
