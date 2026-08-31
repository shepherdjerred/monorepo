---
title: Place, top up, and cancel a Bryan Bucks bet
description: Use the buttons on the pre-match message, add to a position while the market is open, and back out before it closes.
sidebar:
  order: 11
---

You can also place, top up, and cancel bets from the
[web dashboard](/docs/how-to/bryan-bucks-use-the-web-dashboard/).

## Place a bet from the pre-match message

Click one of the four stake buttons on the pre-match card. They read **WIN** or
**LOSE** relative to the tracked player's team, at 1 BB or 5 BB.

The confirmation is private. The pre-match message itself is edited to show the
new totals and your position.

When the tracked players are on opposite teams, the buttons read **Blue** and
**Red** instead — in that lobby "WIN" would not name a single outcome.

## Add to a position

Click a button again on the same game and the same side. The amounts add up
into one position; the confirmation shows the new total.

You cannot hold both sides of the same game. Cancel first if you want to switch.

## Cancel a bet

Click **Cancel** on the pre-match message, before the market closes.

```text
↩️ Cancelled: 10 BB − 2 BB fee = 8 BB back · balance 12 BB.
```

Cancelling an outcome bet costs a fee, because withdrawing liquidity after
other people have priced against you is not free. `/bb rules` has the exact
percentage and rounding. Cancelling a **parlay** is free.

Your cancelled position disappears from the public digest on the pre-match
message, but stays in `/bb history`.

## After the market closes

You cannot cancel. Scout says so plainly:

```text
⏰ Betting is closed — your bet is locked in. Final amounts are on the
game message.
```

That is deliberate — telling someone with a live stake that they have no bet
would be both wrong and alarming.

## Read a settled game's private summary

When the game settles, Scout sends one private summary for that game when DMs
are enabled in your server — an embed naming the game, the tracked players and
their champions, and the result.
If you placed an outcome or parlay bet, it includes your receipt. If Scout tracked you in that game, it also lists other people's
outcome bets as **for your team** or **against your team**.

If you both played and bet, those details are combined into one DM. Scout does
not send a second team-relative line for your own bet, and parlays are only
shown in the bettor's own receipt. The public settlement recap remains
available; if DMs are disabled or unavailable, use `/bb history` to see the
durable ledger entry and running balance.

## Troubleshooting

| Scout says                                        | What to do                                                                                 |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `🔒 Only tracked players can bet.`                | Ask an admin to link your Discord account to a player in the dashboard.                    |
| `💸 You have 3 BB but need 10 BB.`                | Bet less, or earn more by playing.                                                         |
| `↔️ You already backed the other side.`           | Cancel that bet first.                                                                     |
| `🚫 There's no Bryan Bucks market for this game.` | The queue is not eligible — see [the rules reference](/docs/reference/bryan-bucks-rules/). |
