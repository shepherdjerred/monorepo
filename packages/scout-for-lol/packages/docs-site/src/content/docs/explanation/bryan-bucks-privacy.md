---
title: Why balances and estimates stay private
description: Why there is no leaderboard command, why the pre-game estimate is never posted publicly, and what the market message does show.
sidebar:
  order: 6
---

Almost every Bryan Bucks reply is private. That is a design position, not an
oversight, and it comes from two different concerns that happen to point the
same way.

## Estimates: because publishing one prices the market

Scout forms an estimate of who will win before every eligible game. If that
number were posted alongside the betting buttons, there would be no market —
everyone would take the favoured side, nobody would take the other, and every
game would resolve as a house fill.

So the pre-match message carries controls and totals, and nothing else. The
estimate exists, and you can buy private access to it with a peek pass, but it
is never broadcast while the market is open.

Two smaller rules follow from the same reasoning:

- **A peek is delayed.** It becomes available a short time after the game goes
  live, not the instant it is detected. That keeps the pass from being a way to
  see the estimate before the market has had a chance to form.
- **Near-even calls stay hidden even after settlement.** Settlement may reveal
  what Scout thought — but not for a call close to a coin flip. Scoring a
  50.4% call as "right" would claim a direction the estimate never took, and
  publishing it would make Scout look more decisive than it was.

## Balances: because a running scoreboard changes how people bet

There is no `/bb leaderboard`. Standings are posted once a week, on a schedule,
in the shared channel — and that is the only time anyone sees everyone's
numbers.

An always-available leaderboard turns a joke currency into a persistent
ranking. People start betting to defend a position rather than because they
have a view on the game, and the person in last place stops playing. A weekly
snapshot keeps the fun of comparing without the pressure of a live scoreboard.

The same reasoning shapes `/bb ask`. It can analyse this server's betting data,
but its account tool only ever exposes _your_ current balance, and its ledger
queries cannot group by bettor. Those two limits exist together on purpose: if
either were relaxed, the results could be combined to reconstruct somebody
else's balance — which would rebuild the leaderboard the fixed commands
deliberately omit.

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
