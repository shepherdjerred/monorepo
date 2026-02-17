---
name: riot-api-reference
description: |
  Riot Games API reference for League of Legends integration.
  Use when working with twisted library, API endpoints, rate limiting,
  PUUID lookups, match data, summoner info, or regional routing.
---

# Riot Games API Reference

Comprehensive reference for integrating with the Riot Games API for League of Legends data.

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

- <https://raw.communitydragon.org/>

---

## Twisted Library Usage

This project uses the `twisted` npm package for Riot API calls.

### Installation

```bash
npm install twisted
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
