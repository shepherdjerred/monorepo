# Scout User Outreach Plan — 2026-03-27

## Context

Scout prod has had near-zero new subscriptions or command usage for the past 10+ days.
Investigation confirmed no technical issues — the bot is healthy, in 30 guilds, slash
commands registered, gateway stable. This is an engagement/onboarding gap.

Key stats:

- **30 guilds** (growing: 28 → 29 → 30 over 17 days)
- **14 guilds** with active subscriptions, **16 guilds** where bot was installed but never used
- **21 unique users** have ever interacted
- **0 commands** from any user since Mar 24
- Daily leaderboard is failing for all 4 competitions (dead channels/guilds)

## User Segments

### Group A: Active Power Users (4)

**Message:** "Hey! How's Scout working for you? Any bugs or feature suggestions?"

These users have high engagement (10+ actions), use subscriptions actively, and were
last seen within the past 60 days. They're the most likely to give actionable feedback.

| Discord ID           | Username  | Actions | Features                      | Last Active | Days Ago | Server                |
| -------------------- | --------- | ------- | ----------------------------- | ----------- | -------- | --------------------- |
| `127162895925510144` | jamfur    | 14      | sub, player, comp, comp_owner | 2026-03-17  | 10d      | `559140873129164837`  |
| `540490598768181269` | killerra  | 12      | sub, player                   | 2026-03-12  | 15d      | `724380482011398225`  |
| `277850461665624065` | doczinfps | 26      | sub, player                   | 2026-03-11  | 16d      | `446387117895974913`  |
| `811871585018839081` | —         | 10      | sub, player                   | 2026-01-28  | 58d      | `1464521147956596833` |

### Group B: Competition Users (8)

**Message:** "Hey! Saw you created a competition with Scout — is it working as you expected?"

These users specifically used competition features. Some were also heavy users but
have been inactive for 67-109 days. The competition-specific message is more relevant
than a generic check-in.

| Discord ID           | Username | Actions | Features                      | Last Active | Days Ago | Server                                      |
| -------------------- | -------- | ------- | ----------------------------- | ----------- | -------- | ------------------------------------------- |
| `944847302030405642` | —        | 5       | player, comp, comp_owner      | 2026-01-19  | 67d      | `1406738326760984736`                       |
| `535311316215136262` | —        | 2       | comp, comp_owner              | 2026-01-19  | 67d      | `1406738326760984736`                       |
| `410549560465686549` | —        | 4       | player, comp, comp_owner      | 2026-01-09  | 77d      | `750796049035296828`                        |
| `349999173522817024` | —        | 2       | comp, comp_owner              | 2026-01-09  | 77d      | `803956151645241344`                        |
| `832924400658546708` | —        | 13      | sub, player, comp, comp_owner | 2026-01-07  | 79d      | `1208877565872443574`                       |
| `272398412970852363` | —        | 5       | player, comp, comp_owner      | 2026-01-07  | 79d      | `1345142904942760018`                       |
| `681459490088026157` | —        | 6       | sub, player, comp, comp_owner | 2025-12-10  | 107d     | `1448190512606740564`                       |
| `375770974487969792` | —        | 14      | sub, player, comp, comp_owner | 2025-12-08  | 109d     | `1446246347492818974`, `597961214378639360` |

### Group C: Light/New Users (6)

**Message:** "Hey! Saw you installed Scout — need any help getting set up?"

These users created a few subscriptions (1-4) but didn't engage further. They may
have hit friction during onboarding or didn't understand the full feature set.

| Discord ID           | Username | Actions | Features    | Last Active | Days Ago | Server                |
| -------------------- | -------- | ------- | ----------- | ----------- | -------- | --------------------- |
| `495587355995144193` | —        | 4       | sub, player | 2026-02-05  | 50d      | `597961214378639360`  |
| `209498692154032134` | —        | 2       | sub, player | 2026-02-05  | 50d      | `1169428767706464326` |
| `309827487217483778` | —        | 4       | sub, player | 2026-01-24  | 62d      | `1464660502410956916` |
| `335692616928591872` | —        | 4       | sub, player | 2026-01-07  | 79d      | `1208877565872443574` |
| `384724286373625856` | —        | 2       | sub, player | 2025-11-25  | 122d     | `1438582217587687547` |
| `707072002548170790` | —        | 2       | sub, player | 2025-11-23  | 124d     | `1307039636903694376` |

### Group D: Churned Moderate Users (3)

**Message:** "Hey! Haven't seen you on Scout in a while — everything working ok? Open to feedback."

These users had solid engagement (6-12 actions, all subscriptions) but went silent
61-141 days ago. Worth re-engaging to understand what caused them to stop.

| Discord ID           | Username | Actions | Features    | Last Active | Days Ago | Server                |
| -------------------- | -------- | ------- | ----------- | ----------- | -------- | --------------------- |
| `472160876384747531` | —        | 12      | sub, player | 2026-01-25  | 61d      | `1109091803858219018` |
| `523201807867052044` | —        | 6       | sub, player | 2025-12-14  | 103d     | `1307039636903694376` |
| `142778614822338560` | —        | 12      | sub, player | 2025-11-06  | 141d     | `281195730209603595`  |

### Group E: Ghost Guilds (16 servers)

**Action needed:** Look up server owners via Discord API (`guild.fetchOwner()`) and
reach out. These are servers where someone installed the bot but nobody ever ran a command.

The bot is currently in 30 guilds but only 14 have any database records. The remaining
16 guild owners can be resolved via the bot's guild cache using:

```typescript
// On the running bot:
const guildsWithData = new Set([
  /* 14 guild IDs from DB */
]);
for (const [id, guild] of client.guilds.cache) {
  if (!guildsWithData.has(id)) {
    const owner = await guild.fetchOwner();
    console.log(
      `Ghost guild: ${guild.name} (${id}) — owner: ${owner.user.tag} (${owner.id})`,
    );
  }
}
```

**Message:** "Hey! I noticed you added Scout to your server but haven't set anything up yet — want a hand getting started?"

## Other Issues Found

- **Daily leaderboard:** 0/4 competitions posting successfully every night
  - Competition 8: channel `1459198935179464725` deleted (Unknown Channel)
  - Competition 13: missing START snapshot for player 149
  - Two channels with Discord permission errors
  - Two guilds (`1345142904942760018`, `803956151645241344`) returning Unknown Guild (bot removed?)
- **Stale `GuildPermissionError` records:** 11 rows — may need cleanup
