---
title: Bet a Bryan Bucks parlay
description: Read the leg list and odds, take YES or NO on a live in-play market, and cancel for free.
sidebar:
  order: 11
---

A parlay is a second, separate market on the same game. Scout posts it as its
own message shortly after the pre-match card.

```text
🎲 Bryan Bucks Parlay — every leg must hit for YES
1. Virmel gets at least 3 kills
2. Their team gets at least 2 dragons
3. The game duration in seconds is at least 1500

YES 26% (3.85×) · NO 74% (1.35×) · closes in 4 minutes · live in-play market
```

## Read it before you bet

Three things matter, and all three are on the message:

- **Every leg must hit for YES.** Any single leg missing makes the whole
  parlay NO. That is why YES is usually the long odds.
- **The odds are fixed and quoted when you bet.** Unlike the outcome market,
  you are not matched against another player — the house reserves your full
  payout at the price you took.
- **It is a live in-play market.** It is published after the game has already
  started, so early events may already be decided.

## Take a side

Click `YES 1`, `YES 5`, `NO 1`, or `NO 5`, or use the command for any amount:

```text
/bb parlay player: <tracked player> side: YES amount: 20
```

The confirmation is private and tells you the payout you locked in:

```text
✅ Parlay YES position is now 20 BB, paying 77 BB if it wins. Balance: 30 BB.
```

The parlay message itself is edited to show the live positions on each side.

## Add to a position

Bet again on the same side. The position is re-priced as a whole, so the quoted
payout reflects the combined stake.

You cannot hold both YES and NO on the same parlay.

## Cancel

Click **Cancel** on the parlay message before it closes.

```text
↩️ Cancelled: 20 BB back, no fee · balance 50 BB.
```

Parlay cancellation is free and returns the whole stake, unlike the outcome
market. It also releases the payout the house had reserved for you.

## When there is no parlay

Not every game gets one. Scout only publishes a parlay it can _price_ from
history — if the match lake cannot answer a leg, generation records the parlay
as unpriceable rather than guessing a number. See
[how parlay odds are set](/docs/explanation/bryan-bucks-parlay-odds/).
