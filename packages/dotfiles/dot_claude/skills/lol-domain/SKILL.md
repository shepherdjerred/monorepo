---
name: lol-domain
description: |
  League of Legends domain knowledge and terminology.
  Use when working with match data, champion info, ranked systems,
  game objectives, items, runes, or player statistics.
---

# League of Legends Domain Reference

Comprehensive reference for League of Legends game concepts, terminology, and data structures.

---

## Ranked System

### Tiers (Low to High)

| Tier        | Divisions      | Notes                      |
| ----------- | -------------- | -------------------------- |
| Iron        | IV, III, II, I | Lowest tier                |
| Bronze      | IV, III, II, I |                            |
| Silver      | IV, III, II, I | Most populated             |
| Gold        | IV, III, II, I |                            |
| Platinum    | IV, III, II, I |                            |
| Emerald     | IV, III, II, I | Added Season 13            |
| Diamond     | IV, III, II, I |                            |
| Master      | None           | Top 0.2%                   |
| Grandmaster | None           | Top players, 200+ LP       |
| Challenger  | None           | Top 300 players per region |

### LP (League Points)

- Gain/lose LP from wins/losses
- Iron-Platinum: baseline +/-25 LP
- Emerald+: baseline +/-20 LP
- Promotion between divisions at 100 LP
- Master+ uses continuous LP (no promotions)
- Grandmaster requires 200+ LP in Master
- Challenger requires 500+ LP

### Queue Restrictions

**Solo/Duo:**

- Most players: queue within 1 tier
- Iron: can queue up to 2 tiers higher
- Diamond+: within 2 divisions only
- Grandmaster+: solo only

**Flex:**

- Diamond and below: no restrictions
- Master+: must be Emerald+ to queue together

---

## Queue Types

### Ranked Queues

| Queue    | ID  | Players       | Notes                  |
| -------- | --- | ------------- | ---------------------- |
| Solo/Duo | 420 | 1-2           | Main competitive queue |
| Flex 5v5 | 440 | 1, 2, 3, or 5 | No parties of 4        |

### Casual Queues

| Queue          | ID  | Notes                   |
| -------------- | --- | ----------------------- |
| Normal (Draft) | 400 | Same rules as ranked    |
| Normal (Blind) | 430 | Mirror matchups allowed |
| ARAM           | 450 | All Random, All Mid     |

### Special Queues

| Queue       | Notes                        |
| ----------- | ---------------------------- |
| Clash       | Tournament mode              |
| Arena       | 2v2v2v2 mode                 |
| URF         | Ultra Rapid Fire (rotating)  |
| One for All | All same champion (rotating) |

---

## Champion Classes

### Primary Classes

| Class        | Role                          | Examples              |
| ------------ | ----------------------------- | --------------------- |
| **Tank**     | Absorb damage, initiate       | Malphite, Ornn, Leona |
| **Fighter**  | Sustained damage + durability | Darius, Fiora, Jax    |
| **Assassin** | Burst damage, high mobility   | Zed, Akali, Katarina  |
| **Mage**     | Ability-based damage          | Lux, Syndra, Orianna  |
| **Marksman** | Sustained ranged damage       | Jinx, Caitlyn, Kai'Sa |
| **Support**  | Utility, protection           | Thresh, Lulu, Yuumi   |

### Fighter Subclasses

| Subclass       | Traits                               | Examples                   |
| -------------- | ------------------------------------ | -------------------------- |
| **Juggernaut** | Low mobility, high damage/durability | Darius, Mordekaiser, Garen |
| **Diver**      | Engage into backline                 | Irelia, Vi, Camille        |

### Mage Subclasses

| Subclass           | Traits                  | Examples                |
| ------------------ | ----------------------- | ----------------------- |
| **Burst Mage**     | High combo damage       | Syndra, Annie, Veigar   |
| **Battlemage**     | Sustained AoE in fights | Cassiopeia, Ryze, Swain |
| **Artillery Mage** | Extreme range           | Xerath, Lux, Vel'Koz    |

### Assassin Subclasses

| Subclass       | Traits           | Examples           |
| -------------- | ---------------- | ------------------ |
| **Assassin**   | Quick in-and-out | Zed, Talon, Akali  |
| **Skirmisher** | Extended duels   | Yasuo, Yone, Fiora |

---

## Game Objectives

### Dragons (Elemental Drakes)

Spawn at 5:00, respawn 5 minutes after killed. One team getting 4 drakes grants **Dragon Soul**.

| Drake        | Buff                          | Soul Effect                    |
| ------------ | ----------------------------- | ------------------------------ |
| **Infernal** | +AD/AP                        | Attacks cause AoE explosion    |
| **Mountain** | +Armor/MR                     | Shield after not taking damage |
| **Ocean**    | +HP regen                     | Damaging enemies heals you     |
| **Cloud**    | +Movement speed (OOC)         | +Movement speed (permanent)    |
| **Hextech**  | +Attack speed + ability haste | Chain lightning on attacks     |
| **Chemtech** | +Tenacity + heal/shield power | Brief zombie state on death    |

### Elder Dragon

- Spawns after one team gets Dragon Soul
- Grants **Elder Dragon buff**: bonus true damage + execute enemies below 20% HP
- Game-ending objective

### Baron Nashor

- Spawns at 20:00
- **Hand of Baron** buff (210 seconds):
  - Empowered Recall (4 seconds)
  - Bonus AD/AP
  - Empowers nearby minions significantly
- Primary objective for sieging/ending

### Rift Herald

- Spawns at 8:00, despawns at 19:45
- Drops **Eye of the Herald** (consume to summon Herald)
- Herald charges towers for massive damage
- Can spawn twice (second at 13:45 if first killed before 13:45)

### Void Grubs

- Spawn at 5:00 in groups of 3
- Grant **Voidmite** stacks (up to 6)
- Voidmites attack structures alongside you
- Alternative early objective to dragons

---

## Match Statistics

### Core Stats

| Stat             | Description                                    |
| ---------------- | ---------------------------------------------- |
| **KDA**          | Kills/Deaths/Assists ratio: (K+A)/D            |
| **CS**           | Creep Score (minions + jungle monsters killed) |
| **Gold**         | Total gold earned                              |
| **Damage Dealt** | Total damage to champions                      |
| **Damage Taken** | Total damage received                          |
| **Vision Score** | Wards placed + destroyed + control             |

### Gold Values

| Event                | Gold                        |
| -------------------- | --------------------------- |
| Melee minion         | ~21                         |
| Caster minion        | ~14                         |
| Cannon minion        | ~60-90                      |
| Champion kill (base) | 300                         |
| First Blood          | +100 bonus                  |
| Assist               | ~half of kill gold          |
| Shutdown (2+ kills)  | +150 per streak level       |
| Dragon               | ~25-100 per player          |
| Baron                | ~300 per player             |
| Tower                | ~50-250 local + ~100 global |

### Bounty System

| Kill Streak | Bounty     |
| ----------- | ---------- |
| 0 (base)    | 300        |
| 2 kills     | 450        |
| 3 kills     | 600        |
| 4 kills     | 700        |
| 5 kills     | 800        |
| 6 kills     | 900        |
| 7+ kills    | 1000 (max) |

---

## Runes Reforged

### Rune Paths

| Path            | Theme                     | Classes            |
| --------------- | ------------------------- | ------------------ |
| **Precision**   | Sustained damage, attacks | Marksmen, fighters |
| **Domination**  | Burst damage, hunting     | Assassins, mages   |
| **Sorcery**     | Abilities, utility        | Mages, enchanters  |
| **Resolve**     | Durability, defense       | Tanks, supports    |
| **Inspiration** | Creative, rule-breaking   | Various            |

### Precision Keystones

| Keystone             | Effect                             |
| -------------------- | ---------------------------------- |
| **Press the Attack** | 3 hits = bonus damage + damage amp |
| **Lethal Tempo**     | Stacking attack speed              |
| **Fleet Footwork**   | Energized heal + movement speed    |
| **Conqueror**        | Stacking AD/AP + healing           |

### Domination Keystones

| Keystone           | Effect                               |
| ------------------ | ------------------------------------ |
| **Electrocute**    | 3 hits/abilities = burst damage      |
| **Dark Harvest**   | Execute-style scaling damage         |
| **Hail of Blades** | Burst attack speed (3 attacks)       |
| **Predator**       | Movement speed + damage on first hit |

### Sorcery Keystones

| Keystone         | Effect                           |
| ---------------- | -------------------------------- |
| **Summon Aery**  | Damage enemies or shield allies  |
| **Arcane Comet** | Ability hits launch comet        |
| **Phase Rush**   | 3 hits = burst of movement speed |

### Resolve Keystones

| Keystone                 | Effect                           |
| ------------------------ | -------------------------------- |
| **Grasp of the Undying** | Periodic empowered attack + heal |
| **Aftershock**           | CC triggers resistances + damage |
| **Guardian**             | Shield nearby ally when damaged  |

### Inspiration Keystones

| Keystone               | Effect                                |
| ---------------------- | ------------------------------------- |
| **Glacial Augment**    | Slowing zone on immobilize            |
| **Unsealed Spellbook** | Swap summoner spells                  |
| **First Strike**       | Bonus gold/damage when striking first |

---

## Summoner Spells

| Spell        | Cooldown | Effect                             |
| ------------ | -------- | ---------------------------------- |
| **Flash**    | 300s     | Blink short distance               |
| **Ignite**   | 180s     | True damage DoT + Grievous Wounds  |
| **Teleport** | 360s     | Channel to allied structure/minion |
| **Heal**     | 240s     | Heal self + ally + movement speed  |
| **Exhaust**  | 210s     | Slow + damage reduction on enemy   |
| **Barrier**  | 180s     | Temporary shield                   |
| **Cleanse**  | 210s     | Remove CC + reduce incoming CC     |
| **Ghost**    | 210s     | Movement speed boost               |
| **Smite**    | 90s      | Damage to monster/minion (jungler) |

### Common Combinations

| Role    | Common Spells                    |
| ------- | -------------------------------- |
| Top     | Flash + Teleport, Flash + Ignite |
| Jungle  | Flash + Smite (required)         |
| Mid     | Flash + Ignite, Flash + Teleport |
| ADC     | Flash + Heal                     |
| Support | Flash + Ignite, Flash + Exhaust  |

---

## Common Terminology

### Gameplay Terms

| Term    | Meaning                          |
| ------- | -------------------------------- |
| **AA**  | Auto-attack (basic attack)       |
| **AoE** | Area of Effect                   |
| **CC**  | Crowd Control (stun, slow, etc.) |
| **CD**  | Cooldown                         |
| **DPS** | Damage Per Second                |
| **DoT** | Damage over Time                 |
| **OOM** | Out of Mana                      |
| **OOC** | Out of Combat                    |

### Strategic Terms

| Term           | Meaning                                 |
| -------------- | --------------------------------------- |
| **Aggro**      | Aggressive play/drawing enemy attention |
| **All-in**     | Commit all abilities for a kill         |
| **Backdoor**   | Destroy nexus by bypassing enemy team   |
| **Dive**       | Attack under enemy tower                |
| **Gank**       | Surprise attack from jungler            |
| **Kite**       | Attack while retreating                 |
| **Peel**       | Protect carry from threats              |
| **Poke**       | Harass from range                       |
| **Roam**       | Leave lane to help elsewhere            |
| **Split push** | Push side lane while team distracts     |
| **Zone**       | Deny area to enemies with threat        |

### Player State Terms

| Term         | Meaning                     |
| ------------ | --------------------------- |
| **Fed**      | Has many kills, strong      |
| **Behind**   | Less gold/XP than opponent  |
| **Tilted**   | Frustrated, playing worse   |
| **Autofill** | Assigned non-preferred role |

### Meta Terms

| Term                    | Meaning                             |
| ----------------------- | ----------------------------------- |
| **Meta**                | Most effective tactics available    |
| **Powerspike**          | Point where champion becomes strong |
| **Scaling**             | Champion strength growth over time  |
| **Early/Mid/Late game** | Game phases (~0-15/15-30/30+ min)   |

---

## Match Phases

### Early Game (0-15 min)

- Laning phase
- First tower priority
- Drake and Herald contests
- Jungle path optimization

### Mid Game (15-30 min)

- Towers falling
- Roaming and skirmishing
- Dragon Soul race
- Baron attempts

### Late Game (30+ min)

- Full builds approaching
- Baron/Elder Dragon crucial
- One fight can end game
- Death timers are long

---

## Sources

- [League of Legends Wiki - Terminology](https://wiki.leagueoflegends.com/en-us/Terminology)
- [League of Legends Fandom - Terminology](<https://leagueoflegends.fandom.com/wiki/Terminology_(League_of_Legends)>)
- [League of Legends Wiki - Champion Classes](https://wiki.leagueoflegends.com/en-us/Champion_classes)
- [League of Legends Wiki - Ranked Game](https://wiki.leagueoflegends.com/en-us/Ranked_game)
- [Riot Support - Ranked Tiers, Divisions, and Queues](https://support-leagueoflegends.riotgames.com/hc/en-us/articles/4406004330643-Ranked-Tiers-Divisions-and-Queues)
- [Dignitas - LoL Terminology Guide 2025](https://dignitas.gg/articles/league-of-legends-terminology-guide-updated-for-2025)
- [Dignitas - Champion Class Guide](https://dignitas.gg/articles/finding-your-ideal-champion-class-in-league-of-legends)
- [Dignitas - Objectives Guide](https://dignitas.gg/articles/how-to-prioritize-and-secure-objectives)
- [Dignitas - Runes Reforged Overview](https://dignitas.gg/articles/reviewing-runes-reforged-an-overview-of-keystones-in-league-of-legends)
- [Dignitas - Summoner Spells Guide](https://dignitas.gg/articles/summoner-spell-rundown-a-guide-for-league-of-legends)
- [Mobalytics - LoL Terms](https://mobalytics.gg/blog/league-of-legends-terms/)
- [Mobalytics - Summoner Spells](https://mobalytics.gg/lol/guides/summoner-spells)
- [Esports Insider - LoL Ranks Explained](https://esportsinsider.com/league-of-legends-ranks)
- [Esports Insider - LoL Roles Explained](https://esportsinsider.com/league-of-legends-roles-explained)
- [League of Legends Wiki - Dragon Pit](https://wiki.leagueoflegends.com/en-us/Dragon_pit)
- [League of Legends Wiki - Elder Dragon](https://wiki.leagueoflegends.com/en-us/Elder_Dragon)
- [League of Legends Wiki - Rune](https://wiki.leagueoflegends.com/en-us/Rune)
- [League of Legends Wiki - Summoner Spell](https://wiki.leagueoflegends.com/en-us/Summoner_spell)
