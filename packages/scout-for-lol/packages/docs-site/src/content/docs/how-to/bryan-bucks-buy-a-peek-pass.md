---
title: Buy and use a Bryan Bucks peek pass
description: Buy 24 hours of private pre-game estimates, then reveal one for a live game.
sidebar:
  order: 13
---

Scout forms an estimate of who will win before every eligible game. It is never
posted publicly while the market is open — that would price the market for
everyone. A peek pass buys you private access to it.

## Get a quote

```text
/bb pass
```

Scout replies privately with a price and a button:

```text
A 24-hour peek pass costs 12 BB for you right now. This quote expires in
10 minutes.
[ Buy for 12 BB ]
```

The price is not fixed. It scales with your balance and how long you have held
it, with a floor. `/bb rules` states the floor and the rule.

The quote is bound to you and to this server, and it expires. If it goes stale,
or your balance changes underneath it, ask for a new one.

## Buy it

Click **Buy for N BB**.

```text
✅ Peek pass active until tomorrow at 3pm. Paid 12 BB · balance 38 BB.
Use `/bb peek game:<player>`.
```

The pass lasts 24 hours and covers unlimited peeks in that window.

## Reveal an estimate

```text
/bb peek game: <tracked player>
```

```text
🔮 Experimental estimate: 61% win / 39% loss · high data quality.
Drivers: your team rank edge; better recent form.
```

The reply is private, and always framed from _that tracked player's_ team
perspective.

## Timing

A peek becomes available a short time after the game goes live, not the moment
it is detected — see `/bb rules` for the exact delay. Before then:

```text
⏳ This peek will be ready in 40 seconds.
```

And once the game resolves, the private peek is gone:

```text
That game has already resolved, so its private peek is no longer available.
The settlement recap may show the estimate.
```

## Why it might refuse

| Scout says                                             | Meaning                                                                         |
| ------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `🔒 You need an active peek pass.`                     | Buy one with `/bb pass`.                                                        |
| `⌛ Your peek pass expired …`                          | Buy a new one; passes do not auto-renew.                                        |
| `A peek pass costs at least N BB.`                     | Your balance is below the floor.                                                |
| `Scout couldn't produce a reliable pregame analysis …` | There was not enough history to estimate this game. Nothing is hidden from you. |

Estimates are experimental and frozen before the game starts. They never
update mid-game.
