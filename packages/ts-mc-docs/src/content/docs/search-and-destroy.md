---
title: Search and Destroy
description: How Red Warfare Search and Destroy works on The Storm, including bombs, kits, poison, bots and rewards.
---

Search and Destroy is a team minigame played in its own world on The Storm.
It is a port of the 2013–2014 Red Warfare game. Type `/rwf join` to queue
for the next round and `/rwf leave` to go back to survival.

Your survival inventory, XP, health and effects are saved when you enter and
restored when you leave. If the server crashes mid-round, they are restored
the next time you log in.

## How a round works

- You get one life per round. Dying puts you in spectator until the round
  ends.
- The last team with a living player wins. If the last teams are eliminated
  at the same moment, the round is a draw.
- Each team owns one or more TNT bombs. Arming an enemy bomb and letting it
  explode kills that whole team.

## Bombs

Every kit puts a Blaze Powder called **Bomb Fuse** in hotbar slot 1. Hold it
and right-click a bomb:

- Right-click an **enemy** bomb to arm it.
- Right-click your **own** armed bomb to defuse it.

Arming or defusing takes 10 seconds. Each distinct teammate also clicking the
same bomb takes one second off, and some kits carry a fuse bonus. Stop
clicking for more than three quarters of a second and the progress resets.
The last living player on a team arms instantly.

An armed bomb explodes after 60 seconds and kills everyone on the team that
owns it. The crater turns nearby blocks to coal.

Some maps also have unowned **nukes**. Anyone can arm a nuke, and when it
goes off it kills everyone except the team that armed it.

## Poison

Rounds do not last forever. About ten minutes in, or sooner if nobody has
died for 90 seconds, the server gives a one-minute warning. Then your food is
stripped and everyone takes rising damage that cannot be blocked. Standing
within 15 blocks of your own bomb hurts more, so camping your bomb is not a
way to wait it out.

## Kits

Pick a kit with `/rwf kit <name>` before the round starts. All launch kits
are free.

| Kit      | Loadout                                                          |
| -------- | ---------------------------------------------------------------- |
| Trooper  | Iron sword, 3 golden apples, iron armor                          |
| Longbow  | Bow with Punch III, stone sword                                  |
| Shortbow | Bow with Power II, wood sword                                    |
| Rewind   | Clock: teleport to where you were 30 seconds ago (30 s cooldown) |

More kits and killstreaks will arrive later.

## Combat

This world uses old-style combat: there is no attack cooldown, knockback is
the classic kind, and shields and sweep attacks do nothing. Survival keeps
the normal rules.

## Bots

Rounds are filled with AI players, so a round can start with a single human.
Bots have persistent names, skins and play styles, so you will come to
recognise them. They are marked with a dim ✦ after their name in the tab
list and on their nametag, and `/rwf who` lists which players in the round
are bots. They are tuned to be beatable, not perfect.

## Rewards

A win pays 3 Crystals and a loss pays 1. The payout shrinks as the share of
bots in the round rises, and there is a daily cap on what Search and Destroy
can pay you.

## Recordings

Matches are recorded to train the bots. A recording holds positions, actions
and pseudonymous ids. It does not include chat, player names or IP
addresses. You are told this when you join.

## Commands

| Command           | What it does                                |
| ----------------- | ------------------------------------------- |
| `/rwf join`       | Queue for the next round                    |
| `/rwf leave`      | Leave the game and return to survival       |
| `/rwf kit <name>` | Choose your kit for the next round          |
| `/rwf who`        | List the players in the round and mark bots |

## Transparency

Like the rest of the server, the Search and Destroy code lives in
[the public repository](https://github.com/shepherdjerred/monorepo/tree/main/packages/the-storm).
See [Transparency](/survival/transparency/) for what else the server shares.
