---
title: Search and Destroy
description: How Red Warfare Search and Destroy works on The Storm, including bombs, kits, the kit shop, killstreaks, poison, bots and rewards.
---

Search and Destroy is a team minigame played in its own world on The Storm.
It is a port of the 2013–2014 Red Warfare game. Type `/rwf join` to queue
for the next round and `/rwf leave` to go back to survival.

## The lobby

Joining takes you to the lobby, a war room in a world of its own where
everyone waits for the round to start. Nothing can hurt you there, and if you
fall out of it you are put back on the plaza.

- The **rules** and the **match board** show how to play, the map, how many
  players and bots have joined, and how long until the round starts.
- The **armory** has an alcove for every kit, grouped into basic, mid and
  advanced spines. Each alcove shows a kit's icon, name and what it carries,
  with the command to pick it.
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
  more, `/rwf stats top <stat>` the leaders and `/rwf stats history` your last
  matches.

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

Pick a kit from the kit menu (right-click the nether star in the lobby, or type
`/rwf kits`) or with `/rwf kit <name>` before the round starts. If you pick
nothing you play Trooper, and next time you join you start with the kit you
last played.

Every kit carries the Bomb Fuse in the first hotbar slot. Six kits are free for
everyone: Trooper, Longbow, Shortbow, Rewind, Medic and Teleporter. The others
are bought once with Red Warfare Credits and are yours for good.

| Kit         | Price | What it carries                                       | What it does                                                                                                      |
| ----------- | ----- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Trooper     | Free  | Iron sword (Sharpness I), 3 golden apples, iron armor | The standard every other kit is measured against                                                                  |
| Berserker   | 400   | Iron axe (Sharpness II), 2 steaks, no leggings        | Each kill adds 0.7 damage to your hits, up to 7                                                                   |
| Demolitions | 300   | Fire Aspect II sword, 2 landmines                     | Mines arm after 2 seconds and blow up enemies who step on them; your fuse arms and defuses 5 seconds faster       |
| Dwarf       | 500   | Iron sword, iron armor                                | Sneak to level up Sharpness and Protection; high levels slow you, and you lose levels when you stop sneaking      |
| Explosive   | 150   | Stone sword, 5 RPGs, 10 grenades                      | RPGs explode where they hit (30 second recharge, and they can hurt you); grenades explode 3 seconds after a throw |
| Ghost       | 150   | Golden sword, 4 ender pearls, no armor                | Invisible, but held items, sprinting and getting hurt give you away; arrows stay stuck in you for 10 seconds      |
| Juggernaut  | 350   | Stone sword, iron and diamond armor                   | 15 hearts, takes 60% of hits and less knockback, but cannot sprint                                                |
| Longbow     | Free  | Bow (Punch III), stone sword                          | A long-range archer                                                                                               |
| Medic       | Free  | Healing Wand, 20 golden apples, gold armor            | The wand heals allies within 5 blocks; you see everyone's health. No healing in rounds of 20 players or fewer     |
| Pyro        | 200   | Fire Aspect II sword, Flame II bow                    | Sets enemies alight; armor resists fire and explosions                                                            |
| Rewind      | Free  | Iron sword, Time Machine clock                        | Right-click to go back to where you were 30 seconds ago (30 second recharge)                                      |
| Shortbow    | Free  | Bow (Power II), wooden sword (Knockback I)            | A hard-hitting archer                                                                                             |
| Spy         | 250   | Iron sword, iron armor                                | Every enemy sees you as one of their own team, wearing a Trooper kit                                              |
| Teleporter  | Free  | Teleport Creator, Remote Teleporter                   | Place two linked teleporters; teammates sneak on one to reach the other. The remote places one under a teammate   |
| Vampire     | 300   | Vampiric Sword (Sharpness I)                          | Starts with 8 hearts; each kill adds a heart and Regeneration, up to 20 hearts                                    |
| Venom       | 400   | Poisoned Sword                                        | Hits poison and slow enemies for 6 seconds                                                                        |
| Warper      | 250   | Warper's Wand                                         | Use it on an enemy to send them and enemies near them to where you stood 10 seconds ago (30 second recharge)      |
| Ninja       | 200   | Iron sword, 6 ender pearls                            | Speed II and Night Vision                                                                                         |
| Frost       | 150   | Iron sword, ice-blue leather                          | Hits freeze enemy hands for 10 seconds (16 second recharge); your armor softens blows                             |
| Skinner     | 300   | Iron sword (Silk Touch)                               | Takes the name of an enemy slain near you after 3 seconds of dressing, during which your armor does nothing       |
| Wraith      | 200   | Bow (Power II), no armor                              | Invisible like a Ghost; your arrow comes back 2 seconds after each shot                                           |
| Bleeder     | 400   | The Bleeder (wooden sword)                            | Hits deal 2–3 damage and take that much from the enemy's max health for good                                      |
| Equality    | 350   | Iron sword, black and white leather                   | Every hit you deal or take is 3 damage                                                                            |
| Inertia     | 350   | Wooden sword, shield                                  | Running builds up melee damage; sharp turns lose it, and running into a wall hurts                                |
| Sacrificial | 500   | Sacrificial Magic, shears, 10 steaks                  | Bond allies to take their damage for them; direct hits on you hurt four times as much                             |
| Sapper      | 150   | Iron sword, chainmail                                 | Your fuse defuses 3 seconds faster, and explosions do you half damage                                             |
| Saboteur    | 200   | Stone sword, dark leather                             | Your fuse arms 3 seconds faster, and enemies cannot see your team's arming progress until 10 seconds are left     |
| Spotter     | 250   | Iron sword, spyglass                                  | Enemies you see through the spyglass within 60 blocks glow for your team for 6 seconds (30 second recharge)       |
| Grappler    | 300   | Stone sword, grappling hook                           | Reel in to be pulled to where the hook landed, with no fall damage for 3 seconds (5 second recharge)              |
| Bannerman   | 300   | Iron sword, team banner                               | Plant the banner to give allies within 6 blocks Regeneration; enemies break it in 3 hits (45 second recharge)     |
| Engineer    | 400   | Stone sword, bricks                                   | Right-click a block to raise a 3×2 wall for 8 seconds, not near a bomb (25 second recharge)                       |
| Tracker     | 400   | Iron sword, crossbow                                  | See enemy footprints from the last 8 seconds; your first hit marks an enemy on your team's compasses              |
| Decoy       | 450   | Iron sword, decoy                                     | Send a running copy of yourself and turn invisible to enemies for 3 seconds (35 second recharge)                  |

### Buying kits

Buy a kit by clicking it in the kit menu and confirming, or with
`/rwf buy <kit>`. Kits cost Red Warfare Credits, earned by playing (see
Rewards); `/rwf credits` shows how many you have. A kit you have bought is
yours for good.

Each week four bought kits are free for everyone: one or two cheaper kits and
the rest mid or advanced, never the same as the week before. The free kits are
marked in the kit menu and shown on the lobby's board, and `/rwf rotation`
lists them and says when they change. The week turns on Monday at 00:00 UTC.

The full kit list and the shop are being rolled out gradually. Until they
reach you, the menu offers the first four kits.

### Kit layouts

Right-click a kit you can use in the kit menu to arrange its items. Move them
where you like in your inventory and hotbar, then close the menu: the layout
is saved and every later round gives you the kit that way. The Bomb Fuse stays
in the first slot.

### Killstreaks

Kills earn rewards, and an assist counts as your share of the damage. At 2
kills you get a tracking compass that points at the nearest enemy. Every 4
kills you get attack dogs and a supply crate, every 8 an iron golem, and every
11 napalm. Click a block of open ground with the reward: it drops from the
sky and lands there. Dogs and golems fight for your team, and dogs leave when
you die; both leave when the round ends. Killstreaks are being rolled out
gradually too.

## Combat

This world uses old-style combat: there is no attack cooldown, knockback is
the classic kind, and shields and sweep attacks do nothing. Survival keeps
the normal rules.

## Bots

Rounds are filled with AI players, so a round can start with a single human.
Bots have persistent names, skins and play styles, so you will come to
recognise them. They are marked with a dim ✦ after their name in the tab
list and on their nametag, and `/rwf who` lists which players in the round
are bots and the kit everyone has picked. They are tuned to be beatable, not
perfect.

Bots play the same kits you can, and only those: while the full kit list has
not reached anyone in the round, they stick to the first four kits. They use
their kit's items too. A Medic heals hurt teammates, an Explosive fires RPGs
and grenades, Demolitions and Teleporter bots set down mines and teleporters
where they wait, a Spotter marks you, an Engineer or a Decoy reaches for its
item when hurt, and a Grappler hooks its way across the map.

Bots arrive in the lobby a few at a time during the countdown, like players
do. While they wait they wander about, come over to say hello (often by
crouching at you a few times), look at the kit alcoves, hop around and try a
kit or two before settling on the one they play.

Bots also talk. Each one has its own voice and might greet the round, brag
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
