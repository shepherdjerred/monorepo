---
title: Read your Bryan Bucks balance and history
description: Check what you hold, what is at risk, and where every Buck came from.
sidebar:
  order: 14
---

Your history is also available on the
[web dashboard](/docs/how-to/bryan-bucks-use-the-web-dashboard/).

## What you hold right now

```text
/bb balance
```

The reply is private and splits your wallet three ways:

- **Available** — Bucks you can bet with.
- **Reserved / at risk** — Bucks committed to markets that have not settled.
- **Pending positions** — the individual bets making up that reservation.

```text
• jerred WIN — offered up to 5 BB · match pending · closes in 3 minutes
• bryan YES — 10 BB · locked
```

"offered up to" means the market is still open and the final matched amount is
not known yet. After close it reads `matched 5 BB · refunded 0 BB`.

## Where every Buck came from

```text
/bb history
```

A paged, private, transaction-level ledger — every earning, stake, payout,
refund, and fee, newest first, each with the balance it left you at.

```text
`+2` game won · NA1_5625246762 → 27 BB
`-5` bet offer reserved · NA1_5625246762 → 25 BB
`+1` game played · NA1_5625246762 → 30 BB
```

Use **Previous** and **Next** to page. The controls are bound to you; nobody
else can drive your history. The page is also pinned to a snapshot, so a
settlement landing mid-read cannot reshuffle rows underneath you.

`/bb history` is the audit trail. When a private settlement DM or public recap
is unavailable, or when your memory disagrees, this is the record.

## What is open right now

Every market still taking bets keeps its controls on its own message: the
pre-match card for outcome bets, and the parlay messages for YES/NO positions.
A market that has closed shows its receipt in place. Public digests show side
totals only — never who bet what; see
[why balances are private](/docs/explanation/bryan-bucks-privacy/).

## Ask a question instead

```text
/bb ask question: how have I done on parlays this month?
```

One-shot analysis over this server's Bryan Bucks data. The answer starts
private; only you can post it to the channel. Every statistic it states comes
from a real query, not from the model's memory.

## The weekly leaderboard

There is no leaderboard command. The full standings are posted once a week, on
a schedule, in the shared channel. That is deliberate — see
[why balances are private](/docs/explanation/bryan-bucks-privacy/).
