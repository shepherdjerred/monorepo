---
title: Search and Destroy
description: How Red Warfare Search and Destroy works on The Storm, including bombs, kits, poison, bots and rewards.
---

Search and Destroy is a team minigame played in its own world on The Storm.
It is a port of the 2013–2014 Red Warfare game. Type `/rwf join` to queue
for the next round and `/rwf leave` to go back to survival.

## The lobby

Joining takes you to the lobby, a stone room where everyone waits for the
round to start. Nothing can hurt you there, and if you fall out of it you are
put back on the gold spawn pad.

- The **rules** hang on the north wall.
- The **match board** on the south wall shows the map, how many players and
  bots have joined, and how long until the round starts.
- Each **kit alcove** along the east wall shows a kit's weapon, name and
  contents, with the command to pick it.
- The **balcony** on the west side looks out of a window towards the maps.

A bar at the top of your screen says how many more players the round is
waiting for, then counts down to the start. The last five seconds and the
start appear in the middle of your screen.

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

Bots also talk. Each one has its own voice and might greet the round, brag
about a kill, complain about a death, cheer a bomb it armed or say gg at the
end. Their lines appear in chat with the same ✦ after the name, for example
`[Gravel_Fox ✦]: nice try, Alice`, so you can always tell a bot from a
person. Bot chat stays in the Search and Destroy world: only players in the
round and people watching it see it, never survival chat or Discord. Bots do
not read or answer your messages, and each bot waits a while between lines
so chat never floods.

## Rewards

A win pays 3 Crystals and a loss pays 1. The payout shrinks as the share of
bots in the round rises, and there is a daily cap on what Search and Destroy
can pay you.

## Recordings

Matches are recorded to train the bots. A recording holds positions, actions
and pseudonymous ids. It does not include chat, player names or IP
addresses. You are told this when you join.

## Watching

Type `/rwf spectate` to watch a round without playing. Your inventory, XP,
health and effects are saved the same way as when you join, and you watch in
spectator mode from above the arena with the round's scoreboard. Use
`/rwf spectate next` to follow each living player in turn. You keep watching
from one round to the next until you type `/rwf leave`, which returns you to
where you were with everything you had. You cannot watch while you are in the
round, but you can join the next round's lobby straight from watching with
`/rwf join`.

Staff sometimes run a round of bots only. You can watch it, but you cannot
join it.

## Commands

| Command              | What it does                                      |
| -------------------- | ------------------------------------------------- |
| `/rwf join`          | Queue for the next round                          |
| `/rwf leave`         | Leave the game or stop watching, back to survival |
| `/rwf kit <name>`    | Choose your kit for the next round                |
| `/rwf who`           | List the players in the round and mark bots       |
| `/rwf spectate`      | Watch the round in spectator mode without playing |
| `/rwf spectate next` | While watching, follow the next living player     |

## Transparency

Like the rest of the server, the Search and Destroy code lives in
[the public repository](https://github.com/shepherdjerred/monorepo/tree/main/packages/the-storm).
See [Transparency](/survival/transparency/) for what else the server shares.
