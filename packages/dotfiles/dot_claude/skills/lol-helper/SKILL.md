---
name: lol-helper
description: |
  League of Legends domain knowledge, terminology, and Riot Games API reference.
  Use when working with match data, champion info, ranked systems, game objectives,
  items, runes, player statistics, twisted library, API endpoints, rate limiting,
  PUUID lookups, summoner info, or regional routing.
---

# League of Legends Helper

Complete reference for League of Legends game concepts, terminology, data structures, and Riot Games API integration.

---

# Part 1: Game Domain Reference

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

# Part 2: Riot Games API Reference

---

## API Endpoints Overview

### Account-V1 (Riot ID Lookup)

**Base URL:** `https://{region}.api.riotgames.com/riot/account/v1/`

| Endpoint                                    | Description                                    |
| ------------------------------------------- | ---------------------------------------------- |
| `/accounts/by-riot-id/{gameName}/{tagLine}` | Get PUUID by Riot ID                           |
| `/accounts/by-puuid/{puuid}`                | Get account info (gameName + tagLine) by PUUID |

**Important:** Riot IDs replaced summoner names as of November 20, 2023. The `by-name` endpoints are deprecated.

### Summoner-V4

**Base URL:** `https://{platform}.api.riotgames.com/lol/summoner/v4/`

| Endpoint                            | Description                           |
| ----------------------------------- | ------------------------------------- |
| `/summoners/by-puuid/{puuid}`       | Get summoner by PUUID (recommended)   |
| `/summoners/{summonerId}`           | Get summoner by encrypted summoner ID |
| `/summoners/by-account/{accountId}` | Get summoner by encrypted account ID  |

### Match-V5

**Base URL:** `https://{region}.api.riotgames.com/lol/match/v5/`

| Endpoint                        | Description                                    |
| ------------------------------- | ---------------------------------------------- |
| `/matches/by-puuid/{puuid}/ids` | Get list of match IDs for a player             |
| `/matches/{matchId}`            | Get match details by match ID                  |
| `/matches/{matchId}/timeline`   | Get match timeline (not all matches have this) |

**Query Parameters for matchlist:**

- `start` - Start index (default 0)
- `count` - Number of matches (default 20, max 100)
- `queue` - Filter by queue ID
- `type` - Filter by match type (ranked, normal, etc.)
- `startTime` / `endTime` - Filter by timestamp (epoch seconds)

### League-V4

**Base URL:** `https://{platform}.api.riotgames.com/lol/league/v4/`

| Endpoint                               | Description                         |
| -------------------------------------- | ----------------------------------- |
| `/entries/by-summoner/{summonerId}`    | Get ranked entries for a summoner   |
| `/entries/{queue}/{tier}/{division}`   | Get all entries for a tier/division |
| `/challengerleagues/by-queue/{queue}`  | Get challenger league               |
| `/grandmasterleagues/by-queue/{queue}` | Get grandmaster league              |
| `/masterleagues/by-queue/{queue}`      | Get master league                   |

**Note:** If a player hasn't finished placements or isn't ranked in a queue, that queue won't appear in results.

### Champion-Mastery-V4

**Base URL:** `https://{platform}.api.riotgames.com/lol/champion-mastery/v4/`

| Endpoint                                   | Description                |
| ------------------------------------------ | -------------------------- |
| `/champion-masteries/by-puuid/{puuid}`     | Get all champion masteries |
| `/champion-masteries/by-puuid/{puuid}/top` | Get top champion masteries |
| `/scores/by-puuid/{puuid}`                 | Get total mastery score    |

### Spectator-V5

**Base URL:** `https://{platform}.api.riotgames.com/lol/spectator/v5/`

| Endpoint                            | Description                                |
| ----------------------------------- | ------------------------------------------ |
| `/active-games/by-summoner/{puuid}` | Get current game info (404 if not in game) |
| `/featured-games`                   | Get list of featured games                 |

**Limitations:** Stats like role, KDA, or CS are not included. Custom game data is not available due to privacy policies.

### Challenges-V1

**Base URL:** `https://{platform}.api.riotgames.com/lol/challenges/v1/`

| Endpoint                                                  | Description                                               |
| --------------------------------------------------------- | --------------------------------------------------------- |
| `/player-data/{puuid}`                                    | Get player challenge progress                             |
| `/challenges/config`                                      | Get all challenge configurations                          |
| `/challenges/{challengeId}/leaderboards/by-level/{level}` | Get challenge leaderboard (MASTER/GRANDMASTER/CHALLENGER) |

---

## Regional vs Platform Routing

### Platform Routing Values

Used for most endpoints (Summoner-V4, League-V4, Champion-Mastery-V4, Spectator-V5):

| Platform | Region               |
| -------- | -------------------- |
| `na1`    | North America        |
| `euw1`   | Europe West          |
| `eun1`   | Europe Nordic & East |
| `kr`     | Korea                |
| `jp1`    | Japan                |
| `br1`    | Brazil               |
| `la1`    | Latin America North  |
| `la2`    | Latin America South  |
| `oc1`    | Oceania              |
| `tr1`    | Turkey               |
| `ru`     | Russia               |
| `ph2`    | Philippines          |
| `sg2`    | Singapore            |
| `th2`    | Thailand             |
| `tw2`    | Taiwan               |
| `vn2`    | Vietnam              |

### Regional Routing Values

Used for Account-V1 and Match-V5:

| Region     | Platforms Covered       |
| ---------- | ----------------------- |
| `americas` | NA1, BR1, LA1, LA2      |
| `europe`   | EUW1, EUN1, TR1, RU     |
| `asia`     | KR, JP1                 |
| `sea`      | PH2, SG2, TH2, TW2, VN2 |

**Example URLs:**

```text
Platform: https://na1.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/{puuid}
Regional: https://americas.api.riotgames.com/lol/match/v5/matches/by-puuid/{puuid}/ids
```

---

## Rate Limiting

### Three Types of Rate Limits

1. **Application Rate Limit** - Per API key, per region
   - Development keys: 20 requests/second, 100 requests/2 minutes
   - Production keys: Higher limits based on approval

2. **Method Rate Limit** - Per endpoint, per key, per region
   - Each endpoint has its own limit (e.g., match history may be more restricted)

3. **Service Rate Limit** - Per service, shared across all applications
   - Can cause 429 errors without `X-Rate-Limit-Type` header

### Rate Limit Headers

| Header                      | Description                              |
| --------------------------- | ---------------------------------------- |
| `X-App-Rate-Limit`          | Your app's rate limit                    |
| `X-App-Rate-Limit-Count`    | Current count against app limit          |
| `X-Method-Rate-Limit`       | Endpoint's rate limit                    |
| `X-Method-Rate-Limit-Count` | Current count against method limit       |
| `Retry-After`               | Seconds to wait before retrying (on 429) |

### Error Handling

| Code  | Meaning                             | Action                                            |
| ----- | ----------------------------------- | ------------------------------------------------- |
| `429` | Rate limit exceeded                 | Wait for `Retry-After` seconds                    |
| `403` | Forbidden (invalid/blacklisted key) | Check API key validity                            |
| `404` | Not found                           | Resource doesn't exist (e.g., player not in game) |

**Blacklisting:** Repeated violations result in temporary blacklisting (escalating duration), eventually permanent.

---

## PUUID and Riot ID

### Identifier Types

| ID Type         | Scope             | Use Case                             |
| --------------- | ----------------- | ------------------------------------ |
| **PUUID**       | Global, permanent | Preferred for all lookups            |
| **Summoner ID** | Per-region        | Legacy, still used in some endpoints |
| **Account ID**  | Per-region        | Legacy                               |
| **Riot ID**     | Global            | Display name (gameName#tagLine)      |

### Recommended Workflow

1. Get PUUID from Riot ID:

   ```text
   GET /riot/account/v1/accounts/by-riot-id/{gameName}/{tagLine}
   ```

2. Use PUUID for all subsequent calls:

   ```text
   GET /lol/match/v5/matches/by-puuid/{puuid}/ids
   GET /lol/summoner/v4/summoners/by-puuid/{puuid}
   ```

**Note:** PUUIDs are encrypted per project. A PUUID from your dev key won't work with your production key.

---

## Data Dragon (Static Data)

### Base URLs

- **Versions:** `https://ddragon.leagueoflegends.com/api/versions.json`
- **Data:** `https://ddragon.leagueoflegends.com/cdn/{version}/data/{locale}/`
- **Images:** `https://ddragon.leagueoflegends.com/cdn/{version}/img/`

### Common Data Files

| File                   | Content                    |
| ---------------------- | -------------------------- |
| `champion.json`        | All champions (basic info) |
| `champion/{name}.json` | Single champion (detailed) |
| `item.json`            | All items                  |
| `summoner.json`        | Summoner spells            |
| `runesReforged.json`   | Runes                      |
| `profileicon.json`     | Profile icons              |

### Example URLs

```text
Champions: https://ddragon.leagueoflegends.com/cdn/14.24.1/data/en_US/champion.json
Items: https://ddragon.leagueoflegends.com/cdn/14.24.1/data/en_US/item.json
Champion image: https://ddragon.leagueoflegends.com/cdn/14.24.1/img/champion/Ahri.png
Item image: https://ddragon.leagueoflegends.com/cdn/14.24.1/img/item/1001.png
```

### Community Dragon

Data Dragon can be inaccurate (especially champion spell data). Use Community Dragon (`cdragon`) for more accurate data:

- https://raw.communitydragon.org/

---

## Twisted Library Usage

This project uses the `twisted` npm package for Riot API calls.

### Installation

```bash
bun add twisted
```

### Basic Setup

```typescript
import { LolApi, RiotApi, TftApi } from "twisted";

const riotApi = new RiotApi({ key: process.env.RIOT_API_KEY });
const lolApi = new LolApi({ key: process.env.RIOT_API_KEY });
```

### Common Operations

```typescript
// Get PUUID from Riot ID
const account = await riotApi.Account.getByRiotId(
  gameName,
  tagLine,
  RegionGroups.AMERICAS,
);

// Get summoner by PUUID
const summoner = await lolApi.Summoner.getByPUUID(puuid, Regions.AMERICA_NORTH);

// Get match history
const matches = await lolApi.Match.list(puuid, RegionGroups.AMERICAS, {
  count: 20,
});

// Get match details
const match = await lolApi.Match.get(matchId, RegionGroups.AMERICAS);

// Get ranked data
const leagues = await lolApi.League.bySummoner(
  summonerId,
  Regions.AMERICA_NORTH,
);
```

### Configuration Options

```typescript
const api = new LolApi({
  key: "RGAPI-xxx",
  rateLimitRetry: true, // Auto-retry on 429 (default: true)
  rateLimitRetryAttempts: 3, // Max retries
  concurrency: 10, // Max concurrent requests
  debug: {
    logTime: true,
    logUrls: true,
    logRatelimits: true,
  },
});
```

---

## Sources

- [Riot Developer Portal](https://developer.riotgames.com/apis)
- [Rate Limiting Documentation](https://developer.riotgames.com/docs/portal)
- [Data Dragon](https://developer.riotgames.com/docs/lol)
- [Riot API Libraries Documentation](https://riot-api-libraries.readthedocs.io/)
- [HextechDocs - Rate Limiting](https://hextechdocs.dev/rate-limiting/)
- [DarkIntaqt Blog - Routing](https://darkintaqt.com/blog/routing)
- [DarkIntaqt Blog - Summoner V4](https://darkintaqt.com/blog/summoner-v4)
- [DarkIntaqt Blog - IDs](https://darkintaqt.com/blog/ids)
- [Twisted NPM Package](https://www.npmjs.com/package/twisted)
- [Twisted GitHub](https://github.com/Sansossio/twisted)
- [Riot Games DevRel - Summoner Names to Riot ID](https://www.riotgames.com/en/DevRel/summoner-names-to-riot-id)
- [Riot Games DevRel - PUUIDs](https://www.riotgames.com/en/DevRel/player-universally-unique-identifiers-and-a-new-security-layer)
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
