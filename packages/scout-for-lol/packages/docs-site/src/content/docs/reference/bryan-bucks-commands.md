---
title: Bryan Bucks commands
description: Every /bb subcommand, its options, and whether its reply is private.
sidebar:
  order: 12
---

`/bb` is registered per server, not globally. It only appears in servers where
Bryan Bucks is enabled.

## Subcommands

| Command       | What it does                                          | Reply                             |
| ------------- | ----------------------------------------------------- | --------------------------------- |
| `/bb balance` | Available Bucks, Bucks at risk, and pending positions | Private                           |
| `/bb history` | Paged transaction ledger with running balances        | Private                           |
| `/bb open`    | Markets still taking bets, with side totals           | Private                           |
| `/bb bet`     | Place or top up an outcome bet                        | Private                           |
| `/bb parlay`  | Place or top up a parlay bet                          | Private                           |
| `/bb pass`    | Quote and buy a 24-hour peek pass                     | Private                           |
| `/bb peek`    | Reveal one live game's pre-game estimate              | Private                           |
| `/bb ask`     | One-shot analysis over this server's Bryan Bucks data | Private, publishable by the asker |
| `/bb rules`   | The complete rulebook                                 | **Public**                        |
| `/bb prizes`  | The joke prize catalogue                              | **Public**                        |

Everything except `rules` and `prizes` answers only to you. Balances, positions,
and estimates are never posted to the channel by Scout.

## Options

### `/bb bet`

| Option    | Required | Values                                                             |
| --------- | -------- | ------------------------------------------------------------------ |
| `game`    | yes      | A tracked player in the game. Picks _which_ market, not the wager. |
| `outcome` | yes      | `Win`, `Lose`, `Blue`, `Red`                                       |
| `amount`  | yes      | Whole BB, at least the minimum stake                               |

`Win` and `Lose` are relative to the tracked player's team. `Blue` and `Red`
exist because slash-command choices are frozen when the command is registered
and cannot vary per game — they are the only way to express a side in the rare
lobby where tracked players sit on both teams. Asking for `Win` in that lobby
is refused with an explanation rather than guessed.

### `/bb parlay`

| Option   | Required | Values                         |
| -------- | -------- | ------------------------------ |
| `player` | yes      | A tracked player in the parlay |
| `side`   | yes      | `YES`, `NO`                    |
| `amount` | yes      | Whole BB                       |

### `/bb peek`

| Option | Required | Values                       |
| ------ | -------- | ---------------------------- |
| `game` | yes      | A tracked player in the game |

### `/bb ask`

| Option     | Required | Values                                 |
| ---------- | -------- | -------------------------------------- |
| `question` | yes      | Free text, up to the documented length |

## Buttons

The pre-match message carries the outcome market's controls, and the parlay
message carries its own. Both mutate their message rather than posting a
receipt for each bet.

| Message          | Buttons                                                            |
| ---------------- | ------------------------------------------------------------------ |
| Pre-match card   | `WIN · 1 BB`, `WIN · 5 BB`, `LOSE · 1 BB`, `LOSE · 5 BB`, `Cancel` |
| Parlay           | `YES 1`, `YES 5`, `NO 1`, `NO 5`, `Cancel`                         |
| `/bb pass` quote | `Buy for N BB`                                                     |
| `/bb history`    | `Previous`, `Next`                                                 |
| `/bb ask` answer | `Post publicly`                                                    |

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

Bets never add messages. Placing, topping up, and cancelling all edit the
market message in place.
