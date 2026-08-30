---
title: Bryan Bucks commands
description: Every /bb subcommand, its options, and whether its reply is private.
sidebar:
  order: 12
---

`/bb` is registered per server, not globally. It only appears in servers where
Bryan Bucks is enabled.
Most of what `/bb` does — except `/bb ask` — is also available on the
[web dashboard](/docs/how-to/bryan-bucks-use-the-web-dashboard/).

## Subcommands

| Command             | What it does                                          | Reply                          |
| ------------------- | ----------------------------------------------------- | ------------------------------ |
| `/bb balance`       | Available Bucks, Bucks at risk, and pending positions | Private                        |
| `/bb history`       | Paged transaction ledger with running balances        | Private                        |
| `/bb transfer`      | Send half of a total spend to another wallet          | Private result, public receipt |
| `/bb notifications` | Choose settlement DMs about your bets and bets on you | Private                        |
| `/bb rules`         | The complete rulebook                                 | **Public**                     |
| `/bb prizes`        | The joke prize catalogue                              | **Public**                     |

Every command starts privately except `rules` and `prizes`. A successful
`transfer` then posts its sender, recipient, total spend, received amount, and
house fee publicly. Balances and positions are never posted to the channel by
Scout.

Placing, topping up, and cancelling bets happens through the buttons on each
market message — there is no slash command for it.

AI analysis of this server's Bryan Bucks data lives in `/scout ask`: in this
server the Explore agent also carries the bounded Bucks analytics tools, so a
question like "how have I done on parlays this month?" is asked there. Answers
are saved to your private Explore conversation in the web app, where you can
continue, publish, or share them.

## Options

### `/bb transfer`

| Option      | Required | Values                                   |
| ----------- | -------- | ---------------------------------------- |
| `recipient` | yes      | A non-bot member with an existing wallet |
| `amount`    | yes      | Your total whole-BB spend, at least 2 BB |

The recipient receives half rounded down; the house receives half rounded up.
The transfer is immediate and irreversible. Both wallets must already exist in
this server, and you cannot transfer to yourself.

### `/bb notifications`

Both options are optional. With neither option, Scout reports the current
settings. New users default to receiving both categories.
Your first eligible settlement DM carries a reminder that you can manage these
messages with `/bb notifications`; after that the reminder repeats once every
several delivered DMs so it stays discoverable without becoming noise.

| Option        | Required | Values      |
| ------------- | -------- | ----------- |
| `your_bets`   | no       | `On`, `Off` |
| `bets_on_you` | no       | `On`, `Off` |

`your_bets` controls settlement DMs for outcome and parlay bets you placed.
`bets_on_you` controls settlement DMs about other users betting on your tracked
player. Settings are independent and scoped to this server.

## Buttons

The pre-match message carries the outcome market's controls. Match and weekly
parlay messages carry their own controls. All three mutate their message rather
than posting a receipt for each bet.

| Message        | Buttons                                                            |
| -------------- | ------------------------------------------------------------------ |
| Pre-match card | `WIN · 1 BB`, `WIN · 5 BB`, `LOSE · 1 BB`, `LOSE · 5 BB`, `Cancel` |
| Match parlay   | `YES 1`, `YES 5`, `NO 1`, `NO 5`, `Cancel`                         |
| Weekly parlay  | `YES · 1 BB`, `NO · 1 BB`, `Cancel`                                |
| `/bb history`  | `Previous`, `Next`                                                 |

On a mixed lobby the pre-match buttons read `Blue`/`Red` instead of
`WIN`/`LOSE`.

## Messages Scout posts

Per eligible game, at most:

| When       | Message                                                  |
| ---------- | -------------------------------------------------------- |
| Pre-match  | The normal pre-match card, carrying the betting controls |
| Pre-match  | The parlay market, if one could be priced                |
| Post-match | The normal match report                                  |
| Post-match | One settlement embed, replying to the report             |

Weekly parlays are separate from this per-game sequence. Scout publishes a new
message for the market, the betting reminder, every progress update, and the
settlement. Each message puts its current status or result first, then shows
the conditions, activity qualification, bets, and relevant timing. A settlement
explicitly says whether it resolved YES, resolved NO, or was voided and
refunded. Public updates mention people who placed bets, not featured players
who did not bet, and expose only aggregate YES/NO totals—never a person's side
or stake.

Bets never add messages. Placing, topping up, and cancelling all edit the
market message in place. A successful `/bb transfer` is the exception: it adds
one Western Union-style public receipt that mentions only the sender and
recipient and never shows either balance.
