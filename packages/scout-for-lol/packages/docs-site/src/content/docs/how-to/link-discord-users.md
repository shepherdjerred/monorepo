---
title: Link players to their Discord accounts
description: Connect a tracked player to a Discord user so leaderboards and reports can @mention them, and unlink when someone leaves.
sidebar:
  order: 3
---

A tracked player is a League alias. Linking that alias to a Discord user tells
Scout who the person behind it is, which is what lets leaderboards actually ping
them instead of printing a name.

## Link a player to a Discord user

1. Open **Players** and choose the player.
2. Choose **Link Discord**.
3. Pick the member from the list.

The link is stored on the player, so it covers every Riot account under that
alias and every subscription that posts them.

## What linking enables

- **Mentions in leaderboards.** A report rendered with `RENDER leaderboard`
  `@mention`s its top-ranked player rows. Unlinked players appear as plain
  text.
- **Recognizable names** across competitions and reports, so a row means a
  person rather than a League handle nobody recognizes.

Only rows that are actually players get mentioned. A leaderboard grouped by
champion or queue never pings anyone, even if a champion name happens to match
an alias.

## Control how many people a leaderboard pings

Mentions are a `RENDER` option, so you set them per report:

```sql
render leaderboard with (mentions = 5)
```

- `mentions = <n>` — ping the top `n` ranked rows.
- `mentions = all` — ping every eligible row.
- `mentions = 0` — ping nobody.
- Omit it entirely and Scout pings the top three.

Use `mentions = 0` for a report that posts frequently — a daily leaderboard that
pings people every morning gets muted fast.

## Unlink someone

1. Open the player and choose **Unlink Discord**.

The player, their accounts, their subscriptions, and their history all stay.
Only the connection to the Discord user is removed, and they stop being
mentioned.

Do this when someone leaves the server but you want to keep their games in the
server's history.

## Related

- [Add and organize tracked players](/docs/how-to/add-players/)
- [Render kinds and options](/docs/reference/scoutql-render/) — every `WITH`
  option, including `mentions`.
