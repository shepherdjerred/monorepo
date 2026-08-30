---
title: Use the Bryan Bucks web dashboard
description: Check your wallet, browse open markets, place and cancel bets, read your history, and manage settlement DMs from the Scout web app.
sidebar:
  order: 15
---

The Scout web app has a **Bryan Bucks** tab next to Explore and Players. It
appears after you sign in with Discord, when Bryan Bucks is running in a server
you belong to. Everything it shows and does is the same economy as `/bb` — a
bet placed on the web edits the same Discord market message, and a bet placed
in Discord shows up on the web.

## Overview

The overview shows your wallet (balance, at-risk total, pending positions) and
every open market:

- **Match outcome markets** show both sides with each bettor's offer, exactly
  as the Discord market message does. Pick a side, enter a stake (or use the
  quick 1 BB / 5 BB buttons), and place. While the window is open you can add
  to your position or cancel it.
- **Match parlays** and **weekly parlays** show the legs and fixed YES/NO
  odds. Weekly parlays show aggregate totals only.

Cancelling shows you the exact amount you get back and the fee before you
confirm. The numbers are computed for your position; the rules behind them are
in [the rules reference](/docs/reference/bryan-bucks-rules/).

A countdown shows when each market closes. The server is the authority — if a
window closes as you submit, the bet is refused and nothing moves.

## History

The history tab is your private ledger, ten entries per page, newest first.
Pages stay stable while you navigate even as new entries land; use **Refresh**
to jump back to the newest entry. See
[how to read your history](/docs/how-to/bryan-bucks-read-your-history/).

## Leaderboard

The leaderboard tab mirrors the most recent Friday post from Discord — a
snapshot, never live balances. Between posts it does not change.

## Settings

The settings tab holds the same two settlement-DM toggles as
`/bb notifications`: DMs when your own bets settle, and DMs when bets on your
games settle.

## What stays on Discord

Peek passes (`/bb pass`, `/bb peek`) and the analyst (`/bb ask`) are
Discord-only. The web never shows pre-game estimates.
