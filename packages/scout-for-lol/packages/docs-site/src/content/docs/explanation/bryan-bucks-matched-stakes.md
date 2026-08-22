---
title: Why bets use matched stakes
description: Your amount is an offer to risk up to that much, not a promise that all of it is at risk — and why that is the honest design for a market this small.
sidebar:
  order: 5
---

The single most surprising thing about Bryan Bucks is that betting 10 BB does
not mean 10 BB are at risk. It means _up to_ 10 BB are.

That is not a hedge. It falls out of the only design that can work in a server
this small.

## The problem a small market has

An outcome market needs someone on the other side. In a large book that is
never a question — there is always volume. In one server with a handful of
people awake at the same time, it usually is.

There are three ways to handle that, and two of them are bad:

**Take the bet anyway and pay from a pot.** Then the pot has to be funded from
somewhere, and every unbalanced game drains it. Eventually the pot decides who
can bet, silently.

**Refuse the bet until someone takes the other side.** Then most games have no
market at all, and the feature does nothing on a quiet evening.

**Match what you can, return what you cannot.** This is what Scout does.

## How a market actually resolves

When the window closes, Scout matches human offers against each other first, at
even money. If one side is oversubscribed, offers on that side are matched
proportionally — nobody is dropped for being late, everybody is scaled.

Then the house fills what is left, up to a small cap, from a real bankroll.
That cap is **aggregate for the game**, not per player. Five people offering
5 BB each on the same side do not summon five times the liquidity; they share
the same fill, proportionally.

Whatever is still unmatched is returned. No fee, no penalty, no partial credit
— it simply was never a bet.

## Why the house cap is aggregate

A per-player cap would make the house's exposure scale with turnout, which is
exactly backwards: the games where the house is most needed are the quiet ones
with one bettor, and the games where it is least needed are the busy ones. An
aggregate cap keeps the house's worst case per game fixed and knowable, which
is what lets it have a bounded bankroll at all.

It also removes an obvious exploit. If the cap were per player, a group could
split one large position across accounts and multiply the free liquidity.

## What this means when you bet

Read your offer as a ceiling on your risk, not a stake. Three consequences
follow:

- **Offering more is not the same as risking more.** If nobody takes the other
  side, a 100 BB offer and a 10 BB offer can both end up matched at 5 BB.
- **The number you see at close is the real one.** Until the window shuts,
  nothing is settled — which is why the market message shows "offered" while
  open and "matched" after.
- **Unmatched BB cost you nothing.** There is no fee for offering liquidity
  that nobody took.

## Why cancelling is not free

Cancelling _before_ close does cost a fee, and that asymmetry is deliberate.

An open offer is information. Other people price against it, and some of them
take the other side because your offer is sitting there. Withdrawing after
they have committed moves your risk onto them for free. The fee makes that
cost something.

Parlay cancellation is free, because a parlay is priced against the house
rather than against another player — there is nobody on the other side to
strand.

## The record

Every one of these movements is a ledger row: the reservation, the match, the
refund, the fee, the payout. `/bb history` shows them with the balance each one
left you at. The public settlement recap always shows the full arithmetic —
gross, fee, net — so it can be checked against your own ledger rather than
taken on faith.
