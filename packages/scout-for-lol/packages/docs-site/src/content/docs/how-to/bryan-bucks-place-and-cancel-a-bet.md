---
title: Place, top up, and cancel a Bryan Bucks bet
description: Use the buttons or /bb bet, add to a position while the market is open, and back out before it closes.
sidebar:
  order: 11
---

## Place a bet from the pre-match message

Click one of the four stake buttons on the pre-match card. They read **WIN** or
**LOSE** relative to the tracked player's team, at 1 BB or 5 BB.

The confirmation is private. The pre-match message itself is edited to show the
new totals and your position.

## Place a bet with `/bb bet`

Use this for any amount the buttons do not offer:

```text
/bb bet game: <tracked player> outcome: Win amount: 25
```

- `game` picks _which_ open market — it names a tracked player in the game and
  does not decide the wager.
- `outcome` is `Win`, `Lose`, `Blue`, or `Red`.
- `amount` is any positive whole number of BB your wallet can cover.

### When to use Blue or Red

Use them when the tracked players are on opposite teams. Scout will tell you:

```text
Both teams have a tracked player in this game, so `win` and `lose` are
ambiguous — pick `Blue` or `Red`.
```

Slash-command choices cannot change per game, which is why all four are always
listed even though most games only need Win and Lose.

## Add to a position

Run `/bb bet` or click a button again on the same game and the same side. The
amounts add up into one position; the confirmation shows the new total.

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

## Troubleshooting

| Scout says                                        | What to do                                                                                 |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `🔒 Only tracked players can bet.`                | Ask an admin to link your Discord account to a player in the dashboard.                    |
| `💸 You have 3 BB but need 10 BB.`                | Bet less, or earn more by playing.                                                         |
| `↔️ You already backed the other side.`           | Cancel that bet first.                                                                     |
| `🚫 There's no Bryan Bucks market for this game.` | The queue is not eligible — see [the rules reference](/docs/reference/bryan-bucks-rules/). |
