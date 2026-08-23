---
title: Place your first Bryan Bucks bet
description: Bet on a live game, watch the market close, and read the settlement — a complete round trip in about half an hour.
sidebar:
  order: 4
---

Bryan Bucks are friendly points. They have no cash value, nothing can be
redeemed, and `/bb prizes` is part of the joke. This lesson walks one bet from
placement to payout so the rest of the commands make sense.

You need a Discord account linked to a tracked player, and a tracked player who
is about to queue for ranked. Everything happens in the channel Scout already
posts to.

## 1. Check your wallet

Run `/bb balance`. If you have never bet before, Scout tells you there is no
wallet yet — that is expected. A wallet is created the first time you bet, and
it starts with a grant transferred from the house.

The reply is private. Only you see it.

## 2. Wait for a game to start

When a tracked player queues into ranked solo/duo, flex, ranked 5s, or Clash,
Scout posts the usual pre-match card. On a betting-eligible game that card also
carries four stake buttons and a Cancel button.

The buttons read **WIN** and **LOSE**. They mean the tracked player's team —
so `WIN · 5 BB` is "up to 5 BB that they win this game".

:::note
If two tracked players are on _opposite_ teams, "WIN" would be ambiguous, so
the buttons fall back to **Blue** and **Red** instead. This is rare.
:::

## 3. Place the bet

Click `WIN · 5 BB`.

Scout replies privately with something like:

```text
✅ WIN — offered up to 5 BB · balance 20 BB. Only matched BB are at risk;
the rest is refunded at close.
```

Read that last sentence carefully, because it is the one rule that changes what
the number means. **Your amount is a maximum offer, not a guaranteed stake.**
Five Bucks are reserved, but only the portion that finds someone on the other
side is actually at risk.

Now look back at the pre-match message. It has _changed_ — Scout edited it
rather than posting a receipt:

```text
🎲 Bets open · closes in 8 minutes — WIN 5 BB · LOSE 0 BB
WIN @you 5
```

Every bet edits that one message. That is why the channel does not fill up.

## 4. Watch the market close

Ten minutes after Scout detected the game, the market closes. The same message
becomes the receipt:

```text
🎲 Bets closed — WIN 5 BB · LOSE 5 BB (house 5 on LOSE)
• @you WIN 5 → matched 5
```

Nobody took the other side, so the house did — up to 5 BB per game. Had it
matched only part of your offer, the rest would have been refunded, free.

## 5. Read the settlement

When the game ends, Scout posts the normal match report, and replies to it with
one embed:

```text
💰 Bryan Bucks
Pool 10 BB · fees 1 BB · WIN 5 / LOSE 5
🏦 House matched 5 BB.

Bets
• @you WIN 5 → matched 5 · +4 BB (10 − 1 fee = 6 back)

Bucks earned
🪙 TrackedPlayer +2 BB (played, win)
```

You risked 5, won 10 gross, paid a 1 BB fee on the 5 BB of profit, and came
away 4 BB ahead. `/bb balance` now agrees.

## What to do next

- `/bb rules` is the complete rulebook — every fee, window, and cap.
- [Place and cancel a bet](/docs/how-to/bryan-bucks-place-and-cancel-a-bet/)
  covers topping up and backing out.
- [Bet a parlay](/docs/how-to/bryan-bucks-bet-a-parlay/) is the other market.
- [Why bets use matched stakes](/docs/explanation/bryan-bucks-matched-stakes/)
  explains why your offer is a maximum rather than a stake.
