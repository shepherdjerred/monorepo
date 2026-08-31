---
title: Why balances stay private
description: Why there is no leaderboard command and what the market message does show.
sidebar:
  order: 6
---

Almost every Bryan Bucks reply is private. That is a design position, not an
oversight, and it comes from two different concerns that happen to point the
same way.

## Balances: because a running scoreboard changes how people bet

There is no `/bb leaderboard`. Standings are posted once a week, on a schedule,
in the shared channel — and that is the only time anyone sees everyone's
numbers.

An always-available leaderboard turns a joke currency into a persistent
ranking. People start betting to defend a position rather than because they
have a view on the game, and the person in last place stops playing. A weekly
snapshot keeps the fun of comparing without the pressure of a live scoreboard.

The same reasoning shapes AI analysis, which lives in `/scout ask`. The agent
can analyse this server's betting data, but its account tool only ever exposes
_your_ current balance, and its ledger queries cannot group by bettor. Those
two limits exist together on purpose: if either were relaxed, the results
could be combined to reconstruct somebody else's balance — which would rebuild
the leaderboard the fixed commands deliberately omit.

One honesty note about where those answers live: a `/scout ask` answer is
saved into **your** private Explore conversation, including a trace of the tool
calls it made and their results. If you later share or publish that
conversation, the analysis — guild-wide betting aggregates, bettor labels, and
your own balance if you asked for it — travels with it. The structural limits
above still hold; sharing is your action, not Scout's.

## What is public

Four things are public. Three are about the market:

- **Side totals while the market is open**, plus the names of who is on each
  side. Positions are not secret — they are part of the market.
- **The final matched amounts at close**, on the same message, which becomes
  the receipt.
- **The settlement**, with each bettor's gross, fee, and net.

The fourth is an explicit social action: a successful `/bb transfer` posts a
Western Union-style receipt that names and mentions the sender and recipient.
It shows the sender's total spend, the recipient's share, and the house fee so
the movement is transparent. It never shows either person's balance. Failed
transfers remain private.

Cancelled bets disappear from the public digest, though they remain in
`/bb history`. A withdrawn offer is not a position, and leaving it on screen
would misrepresent the market.

## Why the market message is edited rather than reposted

Every bet, top-up, and cancellation edits the market message in place. Nothing
is posted per bet.

That is partly courtesy — a busy game would otherwise bury the channel — but
it is also what makes the totals trustworthy. One message that always shows
current state cannot disagree with itself. A stream of receipts can, and a
reader would have to replay them in order to know where the market stands.
