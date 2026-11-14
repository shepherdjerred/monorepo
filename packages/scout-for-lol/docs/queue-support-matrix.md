# Scout Queue & Ingestion Support Matrix

This internal document details how Scout ingests match data across all supported game queues: whether match discovery and data collection rely on Riot's public developer APIs (**Spectator-V5** and **Match-V5**) or require/benefit from the **Scout Desktop Client** (`scout-client-app`) via local League Client (LCU) uploads.

---

## Ingestion Matrix

| Queue / Game Mode                     | Queue IDs                                           | Pre-Match Source             | Post-Match Source       | Scout Client Required for Post-Match? | Notes                                                                                                                                                                                                                                              |
| :------------------------------------ | :-------------------------------------------------- | :--------------------------- | :---------------------- | :------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Ranked Solo/Duo**                   | `420`                                               | Riot Spectator-V5            | Riot Match-V5           | **No**                                | Full API coverage. Scout Client can enrich live timing & timelines.                                                                                                                                                                                |
| **Ranked Flex**                       | `440`                                               | Riot Spectator-V5            | Riot Match-V5           | **No**                                | Full API coverage.                                                                                                                                                                                                                                 |
| **Ranked 5s**                         | `710`                                               | Riot Spectator-V5            | Riot Match-V5           | **No**                                | Full API coverage.                                                                                                                                                                                                                                 |
| **Normal Draft**                      | `400`                                               | Riot Spectator-V5            | Riot Match-V5           | **No**                                | Full API coverage.                                                                                                                                                                                                                                 |
| **Normal Blind**                      | `430`                                               | Riot Spectator-V5            | Riot Match-V5           | **No**                                | Full API coverage.                                                                                                                                                                                                                                 |
| **Quickplay**                         | `490`                                               | Riot Spectator-V5            | Riot Match-V5           | **No**                                | Full API coverage.                                                                                                                                                                                                                                 |
| **Swiftplay**                         | `480`                                               | Riot Spectator-V5            | Riot Match-V5           | **No**                                | Full API coverage.                                                                                                                                                                                                                                 |
| **ARAM**                              | `450`                                               | Riot Spectator-V5            | Riot Match-V5           | **No**                                | Full API coverage.                                                                                                                                                                                                                                 |
| **Arena** (Cherry)                    | `1700`, `1740`, `1750`                              | Riot Spectator-V5            | Riot Match-V5           | **No**                                | 18-player (6 teams of 3). Match-V5 publishes full placements & augments. Scout Client enriches local ROFL replays.                                                                                                                                 |
| **Clash**                             | `700`                                               | Riot Spectator-V5 (`CUSTOM`) | Riot Match-V5 / Client  | **Optional**                          | Pre-match arrives as `gameType: "CUSTOM"`. The client result is used at once; Riot later publishes under a different Match-V5 id, recorded as an alias.                                                                                            |
| **URF / ARURF**                       | `1900`, `900`                                       | Riot Spectator-V5            | Riot Match-V5           | **No**                                | Full API coverage during active queue windows.                                                                                                                                                                                                     |
| **Brawl**                             | `2300`                                              | Riot Spectator-V5            | Riot Match-V5           | **No**                                | Full API coverage during active queue windows.                                                                                                                                                                                                     |
| **Doom Bots**                         | `4220`, `4240`-`4242`, `4250`-`4252`, `4260`-`4262` | Riot Spectator-V5            | Riot Match-V5           | **No**                                | Match-V5 publishes results. Scout Client discovers bot rosters that Spectator-V5 omits.                                                                                                                                                            |
| **Co-op vs AI**                       | `870`, `880`, `890`                                 | Riot Spectator-V5            | Riot Match-V5 / Client  | **Optional**                          | Live ids per Riot queues.json; 800-850 are retired. Match-V5 publication is unmeasured (no Co-op games in the beta lake). Spectator-V5 omits bots. Ordinary Summoner's Rift `3260`/`3262` (mode `CLASSIC`) classify as Normal, not League Classic. |
| **League Classic** (`JADE`)           | `4310`                                              | Riot Spectator-V5            | **Scout Client Upload** | **YES**                               | **Riot Match-V5 publishes 0 results for JADE (pure 404).** Pre-match works via Spectator (renders Classic loading screen). Post-match scoreboard & stats require paired Scout Client.                                                              |
| **ARAM: Mayhem**                      | `2400`, `3200`, `3220`, `3270`                      | Riot Spectator-V5            | **Scout Client Upload** | **YES**                               | **Riot Match-V5 never publishes results (withheld).** Pre-match works via Spectator. Post-match requires Scout Client (LCU EOG stats block).                                                                                                       |
| **Classic ARAM Mayhem** (`KIWI_JADE`) | `2450`, `3280`                                      | Riot Spectator-V5            | **Scout Client Upload** | **YES**                               | Riot published 20 matches on launch days (2026-07-29/30) and withheld all results since. Requires Scout Client for reliable post-match.                                                                                                            |
| **ARAM Clash**                        | `720`                                               | Riot Spectator-V5 (`CUSTOM`) | **Scout Client Upload** | **YES**                               | Riot Match-V5 404s all post-game spectator IDs. Requires Scout Client upload for post-match scoring.                                                                                                                                               |
| **Custom Games**                      | `0`, `3100`, `3110`, `3130`                         | Riot Spectator-V5 / Client   | **Scout Client Upload** | **YES**                               | Spectator-V5 omits bots and custom teams. Match-V5 withholds custom game results. Scout Client captures full LCU rosters, EOG stats, and replays.                                                                                                  |

---

## Technical Details

### 1. Pre-Match Architecture

- **Riot Spectator-V5 (`/lol/spectator/v5/active-games/by-summoner/{puuid}`)**:
  - Polled every 30 seconds for active tracked players.
  - Captures game start, champions, summoner spells, and game mode.
  - **Limitations**: Omits bots, custom teams, and lobby `partyId`. Fails if spectating is disabled in custom lobbies.
- **Scout Client Pre-Match Enrichment**:
  - Watches LCU gameflow and lobby sessions.
  - Provides complete lobby rosters (including bots and custom team assignments) and bridges `partyId` to `gameId`.

### 2. Post-Match Architecture

- **Riot Match-V5 (`/lol/match/v5/matches/{matchId}`)**:
  - Polled every 60 seconds for newly completed games.
  - Returns complete scoreboard data for standard matchmade queues (Solo/Duo, Flex, Normal, ARAM, Arena, Clash).
  - **Withheld Queues**: Riot Match-V5 explicitly returns `404 Not Found` for League Classic (`JADE`), ARAM Mayhem, ARAM Clash, and Custom games.
- **Scout Client Post-Match Capture**:
  - Scans local League Client via LCU endpoints:
    - `/lol-end-of-game/v1/eog-stats-block` (or `gameclient-eog-stats-block`)
    - `/lol-match-history/v1/games/{gameId}` (full participant statistics)
    - `/game-timelines/{gameId}` (per-minute frames, objectives, events)
    - Local `.rofl` replay files.
  - Uploads signed observations to Scout backend (`/api/scout-client/v1/observations/batch`).
  - Backend canonical converter (`canonical/lcu-match.ts`) normalizes client payloads into Match-V5-compatible representations, allowing Classic, Mayhem, and Custom games to render post-match cards, populate the report lake, and settle competitions.
