# Minecraft Modpack Recommendations

Modpacks with structure, goals, and quest systems for players who prefer guided progression over pure sandbox. Optimized for cozy/building playstyles (Stardew Valley, Pokemon Pokopia fans) with minimal combat.

## Top Picks

### 1. All the Mons (ATM10 + Cobblemon) — MC 1.21.1

- Pokemon catching, breeding, and turn-based battling via Cobblemon
- ATM10 base provides ~500 mods with quest-guided progression
- Minimal Minecraft combat; Pokemon battles are turn-based
- Full multiplayer support
- Available on CurseForge

### 2. FTB StoneBlock 4 — MC 1.21.1

- Underground survival with NPC-guided narrative and branching questlines
- Core loop is crafting, building, and upgrading through quest chapters
- Combat exists in optional Vaults but isn't required for progression
- One-click FTB server hosting for easy co-op
- Available on CurseForge

### 3. Better Minecraft (BMC4/BMC5) — MC 1.20.1

- Vanilla+ with exploration, building, and gentle questing
- Enhances base game without overwhelming — good entry point
- Set difficulty to Peaceful/Easy to minimize combat
- Available on CurseForge

### 4. Create-Focused Packs (e.g., "All of Create") — MC 1.20.1+

- Factory-building and automation with satisfying contraptions
- Zero combat required; quest books provide structure
- Automate farming, design machines, build elaborate systems
- Available on CurseForge

### 5. FTB Skies 2 — MC 1.21.1

- Skyblock with 1,000+ quests across three progression paths
- Very satisfying checklist-style progression
- Full support with FTB Team Bases
- Available on CurseForge

## Pure Cozy Options

- **Farming Valley / Farming Valley Lite** — Stardew Valley recreated in Minecraft (crops, seasons, NPCs, town building). Older versions (1.10/1.12) but exactly the cozy farming vibe.

## Other Notable Packs

- **Prominence II: Hasturian Era** (1.20.1, Fabric) — RPG with story campaigns, talent trees, artifact weapons. More combat-heavy.
- **Vault Hunters 3rd Edition** (1.18.2) — Action RPG dungeon-crawling. Great co-op but combat-focused.
- **All the Mods 10** (1.21.1) — Kitchen-sink with quest-guided endgame. Good if you want everything.

## Notes

- **SkyFactory 4** is abandoned (stuck on 1.12.2) — FTB Skies 2 is the modern replacement
- All packs support multiplayer and are available on **CurseForge**
- Use **CurseForge**, **ATLauncher**, or **Prism Launcher** for installation

## Deployed Servers (March 2026)

All 5 top picks are deployed on the homelab K8s cluster using the itzg/minecraft-server Helm chart with `AUTO_CURSEFORGE` type. Infrastructure details:

| Server           | Hostname               | JVM | K8s Memory | Storage |
| ---------------- | ---------------------- | --- | ---------- | ------- |
| All the Mons     | `allthemons.sjer.red`  | 8G  | 10Gi       | 64Gi    |
| FTB StoneBlock 4 | `stoneblock4.sjer.red` | 6G  | 8Gi        | 32Gi    |
| Better Minecraft | `bettermc.sjer.red`    | 6G  | 8Gi        | 32Gi    |
| All of Create    | `allofcreate.sjer.red` | 6G  | 8Gi        | 32Gi    |
| FTB Skies 2      | `ftbskies2.sjer.red`   | 6G  | 8Gi        | 32Gi    |

- **Whitelist**: RiotShielder, vietnamesechovy
- **mc-router** auto-hibernation: idle servers scale to 0, wake on connect
- **CurseForge API key**: stored in 1Password, shared across all servers
- **DNS**: CNAMEs to `ddns.sjer.red` + SRV records, managed in OpenTofu (`sjer-red.tf`)
- **Code**: shared helper at `packages/homelab/src/cdk8s/src/misc/modded-minecraft.ts`, thin server files in `argo-applications/`
- **No** Velocity, Bedrock, BlueMap, DiscordSRV, or config management (modpacks handle everything)
- **Rate limit note**: deploying all 5 simultaneously can hit CurseForge API rate limits. Stagger first-time startups if redeploying from scratch.

## Context

Researched March 2026. Girlfriend prefers structure/goals (Stardew Valley, Pokemon Pokopia player), not a big fan of combat but OK with it if it feels easier.
