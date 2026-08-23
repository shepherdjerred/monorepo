---
title: How parlay odds are set
description: Why the odds are measured from real match history rather than chosen, and why some games get no parlay at all.
sidebar:
  order: 7
---

A parlay asks whether several things will all happen in one game. Its odds
have to come from somewhere, and the obvious source — asking a language model
what it thinks the chances are — is the wrong one.

## The model proposes; it never prices

Scout generates a parlay in two passes, and they are separated on purpose.

The **first pass** proposes leg _shapes_ only: which player, which statistic,
which direction. No numbers. At that point nobody, including the model, knows
what a reasonable threshold would be.

Only then does Scout measure. It pulls one snapshot of real match history and,
for each proposed leg, computes what that player actually does — plus what
their lane and the wider population do — expressed as "the threshold that lands
N% of the time", already oriented to the leg's direction.

The **second pass** fills in thresholds against those measured distributions,
aiming for legs that land somewhere in the middle rather than being trivially
true or impossible.

A guard sits between the two: the second pass may change numbers and nothing
else. If it re-targets a statistic, flips a direction, or drops a leg, the
whole parlay is rejected. Otherwise it would be choosing a threshold against a
distribution it was never shown, which is exactly the failure the split exists
to prevent.

## The price is replayed, not asserted

The final odds are not the model's opinion. Scout takes the finished leg set
and replays it over the same history snapshot, counting how often all the legs
would have hit together.

Replaying matters because legs are **correlated**. A player who got 15 kills
probably also won, and probably played a long game. Multiplying three
individual probabilities would ignore that and produce a number that is wrong
in a direction nobody can predict. Replaying the real games carries the
correlation exactly.

The model never sees a probability field it could fill in. It does not exist in
the schema it answers.

## No history, no parlay

If the match lake cannot answer a leg, Scout records the parlay as unpriceable
and publishes nothing. It does not fall back to a small number or a guess.

That is why some games get no parlay message. A market with invented odds is
worse than no market, because it looks exactly like a real one.

## Why the odds are fixed rather than matched

The outcome market matches you against other players. The parlay does not — you
are betting against the house at the price quoted when you bet, and the house
reserves your full payout at that moment.

That is what makes the two markets feel different:

- Your parlay payout is known the instant you bet, rather than at close.
- Cancelling a parlay is free, because there is no counterparty to strand.
- Topping up re-prices the whole position, so adding to a bet cannot be used
  to average into a better number than the market offered.

## Why it is a live market

The parlay is published after the game has already started. It says so on the
message, and the design accepts the consequence: early events may already be
decided when you bet.

That is the trade for measuring first. Pricing legs against real history takes
long enough that a pre-game parlay would either be rushed or would delay the
pre-match card. Publishing slightly late, and being honest that it is late, is
better than publishing fast and wrong.

One rule protects the market from the obvious abuse: legs about pings are
always about the **opposing** team. Pings cost nothing to send, and subjects do
bet on their own parlays mid-game — a leg on your own ping count would be a
button you could press. Nobody in the market can move the enemy team's count.
