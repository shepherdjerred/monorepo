# Thick tip sets: Sonnet and Opus on 20 units

The same 20 units (10 matchups and 10 general sets in Mid; the most-played and the least-played the plan includes) written with prompt tips-4 as one batch per generator, 3 to 20 tips per matchup side and 3 to 15 per general set. A unit that fails the validators is resubmitted once with the findings, as the interactive path does; a keyword cite the text does not contain is dropped rather than failing the unit. Every accepted unit is judged by Sonnet (medium, batch) and by the Decisions API; a filter drops the tips its judge calls wrong, and a set left under the minimum is hidden. Spend for the samples: $1.66.

## Projected cost

Over the 2578 pairs and 220 general sets of the plan, at each sample's tokens per unit (input split by champion blocks, output by tips), the batch price and the cache hit rate measured on the one-champion batch. The Decisions API has no batch tier and free output, so it costs what the sample measured.

| Full run                          | Total | generation / filter |
| --------------------------------- | ----- | ------------------- |
| claude-sonnet-5-5 + Sonnet medium | $75   | $41 / $34           |
| claude-sonnet-5-5 + Decisions     | $44   | $41 / $2.61         |
| claude-opus-5-5 + Sonnet medium   | $130  | $89 / $40           |
| claude-opus-5-5 + Decisions       | $92   | $89 / $2.86         |

A typical patch (12 champions changed; every unit touching them regenerated and re-filtered):

| Per patch                         | Total | generation / filter |
| --------------------------------- | ----- | ------------------- |
| claude-sonnet-5-5 + Sonnet medium | $9.87 | $5.38 / $4.49       |
| claude-sonnet-5-5 + Decisions     | $5.73 | $5.38 / $0.35       |
| claude-opus-5-5 + Sonnet medium   | $17   | $12 / $5.35         |
| claude-opus-5-5 + Decisions       | $12   | $12 / $0.39         |

## claude-sonnet-5-5

20 of 20 units passed the validators after the one retry (16 on the first answer; 4 resubmitted).

Spend: $0.66 in total; generation $0.38 (641s), Sonnet $0.26 (305s), Decisions $0.02 (3s, 0.5s per request).

### Tips per set, before and after filtering

A filter drops the tips its judge calls wrong. A set that ends with fewer tips than the minimum is hidden, like a stale one.

| Kind    | Filter                      | Sets | Tips per set before (min / mean / max) | after       | Sets below the minimum after filtering |
| ------- | --------------------------- | ---- | -------------------------------------- | ----------- | -------------------------------------- |
| matchup | Sonnet medium               | 20   | 4 / 5.0 / 6                            | 2 / 3.9 / 6 | 3 of 20                                |
| matchup | Decisions, likeliest answer | 20   | 4 / 5.0 / 6                            | 2 / 3.8 / 6 | 2 of 20                                |
| matchup | Decisions, p(wrong) >= 0.3  | 20   | 4 / 5.0 / 6                            | 1 / 3.0 / 6 | 6 of 20                                |
| general | Sonnet medium               | 10   | 6 / 7.4 / 8                            | 4 / 6.1 / 8 | 0 of 10                                |
| general | Decisions, likeliest answer | 10   | 6 / 7.4 / 8                            | 5 / 6.3 / 8 | 0 of 10                                |
| general | Decisions, p(wrong) >= 0.3  | 10   | 6 / 7.4 / 8                            | 4 / 5.1 / 6 | 0 of 10                                |

### Example sets

Marks show what each judge said about a tip; a tip marked wrong by the filter would be dropped.

### Matchup, popular: Akali vs Viktor (5 games in the plan)

**Akali against Viktor** (6 tips)

1. Dash onto Viktor with Shuriken Flip when his Gravity Field is on cooldown; he has little to stop you from reaching him. _(p(wrong) 0.32)_
2. Walk out of Gravity Field quickly; staying inside it long enough gets you stunned. _(p(wrong) 0.25)_
3. Hit Viktor with Five Point Strike at the edge of its range so he is slowed, then step in to trade. _(p(wrong) 0.21)_
4. Dodge Hextech Ray by moving sideways; it is a slow, narrow beam, so you can sidestep it. _(p(wrong) 0.71)_
5. Save Perfect Execution for when Viktor is low. His Arcane Storm hurts a lot, so your finishing thrust should kill him rather than just trade. _(p(wrong) 0.67)_
6. Drop Twilight Shroud to leave a fight or reset your energy, but expect his area spells to still reveal you. _(p(wrong) 0.14)_

**Viktor against Akali** (6 tips)

1. Keep Akali at a distance with Hextech Ray when she walks up, and aim where she will step. _(p(wrong) 0.17)_
2. Place Gravity Field on top of Akali when she dashes in. Stay in range so it can stun her if she doesn't leave. _(p(wrong) 0.38)_
3. Use Siphon Power just before she engages; the shield helps you survive her burst. _(p(wrong) 0.01)_
4. Cast Arcane Storm on the spot she vanishes into with Twilight Shroud. Area damage still hits her and briefly shows where she is. _(p(wrong) 0.47)_
5. Back off when her Perfect Execution is ready and your Health is low; it hurts more the lower you are. _(p(wrong) 0.36)_
6. Attack when Akali is low on energy; she can't throw Five Point Strike freely then. _(p(wrong) 0.16)_

### Matchup, niche: Anivia vs Taliyah (0 games in the plan)

**Anivia against Taliyah** (6 tips)

1. Walk out of line with Threaded Volley; it flies in a fixed direction, so sidestepping it is easy. Then answer with Flash Frost. _(p(wrong) 0.08)_
2. Follow Flash Frost with Frostbite while the enemy is still chilled; the hit does double damage. _(p(wrong) 0.06)_
3. Stay out of Unraveled Earth when Taliyah casts it. If Seismic Shove then knocks you into the stones, you get stunned. _(p(wrong) 0.04)_
4. Detonate Flash Frost early when Taliyah stands close, so the stun lands. Waiting for full range gives her time to step aside. _(p(wrong) 0.17)_
5. Put Crystallize between you and Taliyah when she commits to a trade; it is solid terrain and blocks her path to you. _(Sonnet: wrong; p(wrong) 0.62)_
6. Fight near Taliyah's Worked Ground carefully; her next Threaded Volley there is a slowing boulder that hits harder. _(p(wrong) 0.10)_

**Taliyah against Anivia** (6 tips)

1. Throw Threaded Volley at Anivia when she walks up to last-hit; she has little to dodge with in a narrow lane. _(p(wrong) 0.01)_
2. Dodge Flash Frost sideways, and never stand where it will end; the burst at its end stuns. _(p(wrong) 0.02)_
3. Cast Unraveled Earth, then shove Anivia into it with Seismic Shove. She gets stunned and takes extra damage. _(Sonnet: wrong; p(wrong) 0.37)_
4. Reuse your Threaded Volley on Worked Ground for a cheap, slowing boulder when Anivia tries to close in. _(p(wrong) 0.03)_
5. Do not rush Anivia's wall. Crystallize blocks movement, so wait for it to melt or walk around it. _(p(wrong) 0.07)_
6. Anivia's egg is hard to kill early, so back off when she is low. Ganks make sure the egg dies. _(Sonnet: wrong; p(wrong) 0.49)_

### General, popular: Ahri (60 games in the plan)

**Ahri in Mid, general** (8 tips)

1. Land Charm first, then follow with Orb of Deception and Fox-Fire; the charmed enemy can't dodge them. _(p(wrong) 0.95)_
2. Aim Charm when no minion stands in the line, because it stops at the first enemy it hits. _(p(wrong) 0.11)_
3. Throw Orb of Deception so it hits the enemy on the way out and again as it returns. Standing in its path or at its turnaround point gets you hit twice. _(p(wrong) 0.28)_
4. Cast Fox-Fire to push the wave or poke; the flames target champions first, then minions that would die to them. _(p(wrong) 0.34)_
5. Use Fox-Fire for its Move Speed burst to close in or slip away after a trade. _(p(wrong) 0.02)_
6. Use Spirit Rush to dodge, reposition or chase down a weakened enemy. Spend its recasts, since a takedown grants an extra one. _(p(wrong) 0.15)_
7. Play safer while Spirit Rush is on cooldown, because Ahri has little escape without it. _(p(wrong) 0.04)_
8. Last-hit minions steadily; Essence Theft heals Ahri after enough kills, and a champion takedown heals more. _(p(wrong) 0.01)_

### General, niche: Azir (10 games in the plan)

**Azir in Mid, general** (8 tips)

1. Last-hit and threaten the enemy by placing soldiers between their minions and their champion with Arise! _(p(wrong) 0.01)_
2. Unless you are going all-in, keep one soldier unplaced so Shifting Sands can escape or hit right away, even when you spend Arise! _(Sonnet: wrong; p(wrong) 0.16)_
3. Attack the enemy while they stand near your soldiers. Azir then orders the soldiers to stab, so you can hit from farther away. _(p(wrong) 0.49)_
4. Use Conquering Sands to send your soldiers through the enemy. They take damage and are slowed, which helps you trade or chase. _(p(wrong) 0.00)_
5. Shifting Sands gives you a shield as you dash, so use it to join a trade. It also lets you dodge enemy skillshots. _(Sonnet: wrong; p(wrong) 0.70)_
6. Use Emperor's Divide to defend first. Cast it when an enemy dives on you, so they are knocked back and cannot walk through the wall your team can pass. _(Sonnet: wrong; p(wrong) 0.32)_
7. Do not fight under an enemy turret. Your soldiers expire much faster there. _(Sonnet: wrong; p(wrong) 0.22)_
8. After a turret falls, use Shurima's Legacy to build a Disc of the Sun on the ruins. It acts as a turret that helps you push. _(p(wrong) 0.20)_

## claude-opus-5-5

20 of 20 units passed the validators after the one retry (18 on the first answer; 2 resubmitted).

Spend: $1.00 in total; generation $0.77 (701s), Sonnet $0.21 (320s), Decisions $0.02 (2s, 0.4s per request).

### Tips per set, before and after filtering

A filter drops the tips its judge calls wrong. A set that ends with fewer tips than the minimum is hidden, like a stale one.

| Kind    | Filter                      | Sets | Tips per set before (min / mean / max) | after       | Sets below the minimum after filtering |
| ------- | --------------------------- | ---- | -------------------------------------- | ----------- | -------------------------------------- |
| matchup | Sonnet medium               | 20   | 6 / 6.5 / 7                            | 1 / 5.3 / 7 | 1 of 20                                |
| matchup | Decisions, likeliest answer | 20   | 6 / 6.5 / 7                            | 2 / 4.2 / 7 | 2 of 20                                |
| matchup | Decisions, p(wrong) >= 0.3  | 20   | 6 / 6.5 / 7                            | 1 / 3.3 / 6 | 6 of 20                                |
| general | Sonnet medium               | 10   | 8 / 9.9 / 12                           | 6 / 7.9 / 9 | 0 of 10                                |
| general | Decisions, likeliest answer | 10   | 8 / 9.9 / 12                           | 7 / 7.9 / 9 | 0 of 10                                |
| general | Decisions, p(wrong) >= 0.3  | 10   | 8 / 9.9 / 12                           | 3 / 6.8 / 8 | 0 of 10                                |

### Example sets

Marks show what each judge said about a tip; a tip marked wrong by the filter would be dropped.

### Matchup, popular: Akali vs Ahri (7 games in the plan)

**Akali against Ahri** (7 tips)

1. Stand behind your minions so Charm hits a minion instead of you. _(Sonnet: wrong; p(wrong) 0.47)_
2. Go in once Charm is on cooldown. Without it she has a much harder time stopping you. _(p(wrong) 0.44)_
3. Hit her with Five Point Strike at the tip of its range, where it leaves her slowed. _(p(wrong) 0.12)_
4. After hitting her with an ability, step out of the ring Assassin's Mark makes, then hit her with your stronger, longer-range attack. _(p(wrong) 0.26)_
5. Drop Twilight Shroud when she throws Orb of Deception so she has a hard time aiming the return pass at you. _(p(wrong) 0.50)_
6. Land Shuriken Flip, then recast it to dash onto her. Don't recast it while Charm is up and she can hit you as you arrive. _(p(wrong) 0.50)_
7. Save the second dash of Perfect Execution for after she uses up Spirit Rush, so she can't dash away from it. _(p(wrong) 0.60)_

**Ahri against Akali** (7 tips)

1. Throw Orb of Deception at Akali when her Energy is low. She can't trade back until it refills. _(p(wrong) 0.93)_
2. Akali can still be hit inside Twilight Shroud. Throw Orb of Deception through the smoke to reveal her. _(p(wrong) 0.60)_
3. Keep Charm for when Akali dashes at you with Shuriken Flip; she comes straight at you. _(p(wrong) 0.68)_
4. Stay out of the tip range of Five Point Strike. It leaves you slowed there and hits hardest at long range. _(Sonnet: wrong; p(wrong) 0.84)_
5. Save one Spirit Rush dash to get away from the second dash of Perfect Execution. _(p(wrong) 0.11)_
6. Go back to base when your Health is low and she has her ultimate ready after level 6. _(p(wrong) 0.04)_
7. Cast Fox-Fire after she leaves the smoke. The flames only go after enemies you can see. _(p(wrong) 0.22)_

### Matchup, niche: Anivia vs Taliyah (0 games in the plan)

**Anivia against Taliyah** (7 tips)

1. Sidestep Threaded Volley; the rocks fly in one fixed direction, so move to the side while she throws. _(p(wrong) 0.01)_
2. When Unraveled Earth lands near you, walk out of the stones at once; Seismic Shove can throw you across them and leave you stunned. _(p(wrong) 0.04)_
3. Seismic Shove erupts after a short delay, so step off the marked spot as soon as you see it. _(p(wrong) 0.15)_
4. Hit her with Flash Frost first, then follow with Frostbite for double damage. _(p(wrong) 0.20)_
5. She casts most spells while standing on her Worked Ground. Put Glacial Storm on that spot to make her stay and get hurt or give it up. _(p(wrong) 0.99)_
6. Hit her when she tries to leave on Weaver's Wall; she can't start it if a champion damaged her in the last few seconds. _(Sonnet: wrong; p(wrong) 0.25)_
7. Before level 6, keep trading hard; your egg makes you hard to kill early. _(p(wrong) 0.42)_

**Taliyah against Anivia** (7 tips)

1. Move sideways when the ice chunk is coming; Flash Frost stuns where it bursts, so get out of its path and away from where it ends. _(Sonnet: wrong; p(wrong) 0.06)_
2. Throw Unraveled Earth near her, then use Seismic Shove to knock her through the stones for a stun. _(p(wrong) 0.01)_
3. Stun or knock Anivia away while Glacial Storm is up; disables turn it off. _(p(wrong) 0.02)_
4. Walk out of Glacial Storm early, before it reaches full size and hits much harder. _(p(wrong) 0.11)_
5. Use Threaded Volley's short cooldown to poke her from long range and drain her mana. _(p(wrong) 0.70)_
6. Call your jungler before you go for a kill; it is easier to finish her egg with help. _(p(wrong) 0.03)_
7. Keep an escape ready when Crystallize is up; her ice wall can cut off your way out. _(p(wrong) 0.01)_

### General, popular: Zed (58 games in the plan)

**Zed in Mid, general** (12 tips)

1. Place Living Shadow first, then throw Razor Shuriken so both shurikens hit the same target for much more damage. _(p(wrong) 0.28)_
2. Razor Shuriken passes through minions, but the first unit it hits takes the most damage. Aim for lanes where the enemy stands in front. _(Sonnet: wrong; p(wrong) 0.63)_
3. Hit the same enemy with both you and your shadow to get energy back, so you can keep trading longer. _(p(wrong) 0.36)_
4. Hit an enemy champion with your own Shadow Slash to make Living Shadow come back sooner. _(p(wrong) 0.03)_
5. Only your shadow's Shadow Slash leaves enemies slowed, so place the shadow next to them when you need to catch them. _(p(wrong) 0.72)_
6. After you place a shadow with Living Shadow, keep the swap ready so you can escape a gank or a bad trade. _(p(wrong) 0.04)_
7. You cannot swap with your shadow while rooted, so stay away from enemies who can root you when your escape depends on it. _(p(wrong) 0.10)_
8. Save your energy and abilities for after Death Mark lands; the mark repeats part of all the damage you deal before it goes off. _(p(wrong) 0.77)_
9. Place Living Shadow before you use Death Mark so you have two places to swap to on the way out. _(Sonnet: wrong; p(wrong) 0.51)_
10. Use Death Mark to dodge a big incoming spell; you can't be targeted during the dash. _(Sonnet: wrong; p(wrong) 0.06)_
11. Basic attack enemies who are below half health; Contempt for the Weak adds bonus damage. _(p(wrong) 0.01)_
12. Avoid long fights after Living Shadow is used up; without it you lose most of your damage and your escape. _(p(wrong) 0.52)_

### General, niche: Talon (10 games in the plan)

**Talon in Mid, general** (11 tips)

1. Hit an enemy with Rake on the way out and again on the way back, then use Noxian Diplomacy. The third hit lets your next attack make them bleed hard. _(Sonnet: wrong; p(wrong) 0.32)_
2. After stacking Blade's End, attack the enemy right away. If you wait, the stacks run out. _(p(wrong) 0.66)_
3. Use Noxian Diplomacy when you are already next to your target. Up close it lands a critical strike for more damage. _(p(wrong) 0.10)_
4. Finish low minions or enemies with Noxian Diplomacy. A kill heals you and cuts its cooldown in half. _(p(wrong) 0.13)_
5. Throw Rake through the minion wave so it hits the enemy laner too. The blades pass through every unit they hit. _(Sonnet: wrong; p(wrong) 0.95)_
6. Use Assassin's Path to jump walls and roam to side lanes. Each wall can't be jumped again for a while, so plan your way back. _(p(wrong) 0.04)_
7. Start Shadow Assault next to your target, then hit them with a basic attack. All the blades fly back into them. _(Sonnet: wrong; p(wrong) 0.19)_
8. Save Shadow Assault to escape when a fight goes wrong. While it is on cooldown, play safer. _(p(wrong) 0.04)_
9. Choose one target before you go in, and put every ability on them instead of spreading damage around. _(p(wrong) 0.11)_
10. A spell shield blocks Noxian Diplomacy. Pop the shield with Rake before you leap in. _(p(wrong) 0.58)_
11. Catch fleeing enemies with the returning blades of Rake. They leave enemies slowed so you can finish them. _(p(wrong) 0.03)_
