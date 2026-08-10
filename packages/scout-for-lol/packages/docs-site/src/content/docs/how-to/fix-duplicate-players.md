---
title: Fix duplicate or mis-assigned players
description: Merge two aliases that are the same person, move a Riot account to the right player, and recover from a mistyped Riot ID.
sidebar:
  order: 4
---

Duplicates happen when the same person gets added twice under different aliases
— usually because two people set them up, or because a smurf was added as a new
player instead of a second account. The symptom is a leaderboard where one
person occupies two rows and neither has their full game count.

## Merge two aliases that are the same person

1. Open **Players** and choose the alias you want to keep.
2. Choose **Merge**.
3. Pick the alias to merge into it.

The accounts, matches, and history from the merged alias move under the one you
kept. Their leaderboard rows collapse into a single row with the combined games.

Choose the surviving alias deliberately — it is the name that stays visible in
notifications and reports.

## Move one account instead of merging

Merging is for _the same person recorded twice_. If instead a single Riot
account landed on the wrong person, move just that account:

1. Open the player that currently holds it.
2. Find the account and choose **Transfer**.
3. Pick the correct player.

Use this when two real, different people are involved — merging them would be
wrong.

## Fix a mistyped Riot ID

If the Riot ID was wrong at creation, Scout is tracking a different account, or
none at all.

1. Open the player and find the account.
2. Choose **Edit** and correct the Riot ID or region.

If the corrected account is one Scout already tracks elsewhere in the server,
the edit is refused — a Riot account can belong to only one player per server.
Move the account with **Transfer** instead.

## Check what changed

Open **Audit**. Merges, transfers, edits, and deletions are all recorded with
who did them, so you can confirm what a merge actually moved — or find who
removed something.

## Avoid duplicates in the first place

- Add smurfs as **additional accounts** on the existing player, never as a new
  player. See [Add and organize tracked
  players](/docs/how-to/add-players/).
- Agree on an alias convention before more than one person starts adding
  players.
- Restrict who can add players with [Grant dashboard access without Discord
  admin](/docs/how-to/grant-access/).

## Related

- [How players, accounts, and subscriptions
  relate](/docs/explanation/players-accounts-subscriptions/)
