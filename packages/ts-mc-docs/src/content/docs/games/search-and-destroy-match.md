---
title: Search and Destroy match details
description: Lobby, match, bot, reward and spectator details for Search and Destroy.
---

Learn more about the lobby and matches in [Search and Destroy](/search-and-destroy/).

For choosing equipment, see [kits and the shop](/games/search-and-destroy-kits/). For arming and defusing, see [bombs](/games/search-and-destroy-bombs/).

## The lobby

Joining takes you to the lobby, a war room in a world of its own where
everyone waits for the round to start. Nothing can hurt you there, and if you
fall out of it you are put back on the plaza.

- The **rules** and the **match board** show how to play, the map, how many
  players and bots have joined, and how long until the round starts.
- The **armory** has kit alcoves grouped into basic, mid and advanced spines.
  Each alcove shows a kit's icon, name and what it carries, with the command
  to pick it. Only kits in the current match pool can be selected.
- The armory's **rotation wall** shows the four kits that are free to play
  this week.
- Three **vote podiums** show the maps you can vote for, and the
  **leaderboards** show the top players for kills, wins and win streak.
- The **balcony** looks out over the lobby.

Your hotbar holds two lobby items. Right-click the **nether star** to open
the kit menu and click a kit to pick it; your current kit glints. Right-click
the **red dye** to leave and go back to survival. Both disappear when the
round starts.

A bar at the top of your screen says how many more players the round is
waiting for, then counts down to the start. The last five seconds and the
start appear in the middle of your screen.

Your survival inventory, XP, health and effects are saved when you enter and
restored when you leave. If the server crashes mid-round, they are restored
the next time you log in.

## The new match flow

These parts of Search and Destroy are rolling out and may not be switched on
yet:

- **Map vote.** Three maps go on the vote as the lobby opens. Vote with
  `/rwf vote <map>` or by right-clicking a podium's lodestone. The vote
  closes 20 seconds before the start, and the map with the most votes wins.
- **Preview and freeze.** Before the round, everyone looks around the chosen
  map for 10 seconds (you can still change kit), then teams are dealt and
  everyone is frozen at their start for 5 seconds.
- **Straight into the next round.** When a round ends, you go back to the
  lobby with your kit and play the next round without typing `/rwf join`
  again. `/rwf leave` still takes you back to survival.
- **Death messages and assists.** Every death is announced in team colours,
  the tab list shows kills, and if you did more than a tenth of the damage
  to someone a teammate killed, you are told your assist.
- **Team chat.** During a round your chat goes to your team; start a line
  with `@` (or use `/g`) to talk to everyone, and `/rwf teamchat` flips the
  default. The dead and watchers talk among themselves.
- **Spectating.** When you die you watch your killer for a moment, then get a
  compass to pick who to follow.
- **Bombs.** Armed bombs hiss and smoke, each team's arming progress shows above
  the bomb, and the explosion is heard across the map.
- **Statistics.** `/rwf stats` shows your lifetime kills, assists, wins and
  more, `/rwf top <stat>` the leaders and `/rwf history` your last
  matches.

## Poison

Rounds do not last forever. About ten minutes in, or sooner if nobody has
died for 90 seconds, the server gives a one-minute warning. Then your food is
stripped and everyone takes rising damage that cannot be blocked. Standing
within 15 blocks of your own bomb hurts more, so camping your bomb is not a
way to wait it out.

## Bots

Rounds are filled with bots, so a round can start with a single human.
Bots have persistent names, skins and play styles, so you will come to
recognise them. They are marked with a dim ✦ after their name in the tab
list and on their nametag, and `/rwf who` lists which players in the round
are bots and the kit everyone has picked. They are tuned to be beatable, not
perfect.

The bots use pathfinding to find their way around the map and game-specific
rules to guide their decisions. For example, they can choose a bomb to approach, pursue an
enemy they have seen, fight with a sword or bow, and work with teammates to
arm or defend a bomb. They can remember where they saw an enemy and respond
to sightings shared by teammates. They do not use a large language model or
generative AI. Their chat uses prewritten lines chosen for what is happening,
sometimes with a player's name filled in.

Bots choose from the first four kits unless the full kit list is enabled for
at least one player in the match. In that case, they can choose any kit in the
current match pool, even one you haven't unlocked. They use their kit's items
too. A Medic heals hurt teammates, an Explosive fires RPGs and grenades, and
Demolitions and Teleporter bots set down mines and teleporters where they wait.

Bots arrive in the lobby a few at a time during the countdown, like players
do. While they wait they wander about, come over to say hello (often by
crouching at you a few times), look at the kit alcoves, hop around and try a
kit or two before settling on the one they play.

When bot chat is enabled, bots can talk. Each one has its own voice and might greet the round, brag
about a kill, complain about a death, cheer a bomb it armed or say gg at the
end. In the lobby they say hi as they walk in, chat a little while they wait
and comment on the countdown; say hi in the lobby and one of them may say hi
back. Their lines appear in chat with the same ✦ after the name, for example
`[G][● Gravel_Fox ✦]: nice try, Alice`, so you can always tell a bot from a
person. A bot calls its own team's moments (a bomb it armed or defused,
being the last one left) in team chat, so only its teammates hear them, and
`/ignore` works on bots as it does on players. Bot chat stays in the Search and Destroy world: only players in the
round and people watching it see it, never survival chat or Discord. Bots
only answer a greeting or a remark in the lobby; they do not read your
messages during the round, and each bot waits a while between lines so chat
never floods.

## On Discord

The server's Discord channel announces when someone opens an empty Search and
Destroy lobby, so others know to join. It also posts each result: the map, the
winning team, the players on it and how long the match lasted, or everyone
still in the match after a draw. Rounds with only bots and rounds an admin stops
are not posted.

In that channel, `/rwf-stats <player>` shows a player's matches, wins, losses,
kills and deaths, and `/status` shows who is online and which games are
running.

## Rewards

Search and Destroy pays in its own currency, Red Warfare Credits (RC), not
Crystals. A win pays 3 Credits and a loss pays 1, as in the original Red
Warfare. The payout shrinks as the share of bots in the round rises, and a
round shorter than a minute pays nobody. There is no daily cap.

You forfeit the round's reward if you kill yourself or leave the round while
it is being played, even after you have died. If you never turn your head
during the round you count as away (AFK): you earn nothing and lose 2
Credits, though never more than you hold.

`/balance` shows your Credits next to your Crystals, and `/baltop rwf_credits`
lists the players with the most Credits.

## Recordings

Matches are recorded to train the bots. A recording holds positions, actions
and pseudonymous ids. It does not include what you say in chat (only that a
line was sent and how long it was), player names or IP addresses. You are told
this when you join.

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

| Command                       | What it does                                       |
| ----------------------------- | -------------------------------------------------- |
| `/rwf join`                   | Queue for the next round                           |
| `/rwf leave`                  | Leave the game or stop watching, back to survival  |
| `/rwf kit <name>`             | Choose your kit for the next round                 |
| `/rwf kits`                   | Open the kit menu                                  |
| `/rwf buy <kit>`              | Buy a kit with Red Warfare Credits                 |
| `/rwf rotation`               | This week's free kits and when they change         |
| `/rwf credits`                | Your Red Warfare Credits                           |
| `/rwf who`                    | List the players in the round and mark bots        |
| `/rwf vote <map>`             | Vote for the next map                              |
| `/rwf time`                   | How long until the round starts or how long in     |
| `/rwf teamchat`               | Switch whether your chat goes to your team         |
| `/rwf stats [player]`         | Lifetime statistics                                |
| `/suicide`                    | Die, during a round                                |
| `/rwf spectate`               | Watch the round in spectator mode without playing  |
| `/rwf spectate next/previous` | While watching, follow the next or previous player |
| `/rwf goto <player>`          | While watching, follow that player                 |

## Transparency

Like the rest of the server, the Search and Destroy code lives in
[the public repository](https://github.com/shepherdjerred/monorepo/tree/main/packages/the-storm).
See [Transparency](/survival/transparency/) for what else the server shares.
