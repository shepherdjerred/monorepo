---
title: Operate Scout custom nights
description: Configure the beta Discord Activity, register Riot Tournament-V5, recover interrupted nights, and verify Riot-only results.
sidebar:
  order: 12
---

Scout custom nights are permanently beta-only. Production has no
`/customs/index.html`, and the backend hard-disables both Customs and Tournament
lobbies even if a flag provider returns `true`.

Keep `custom_nights_enabled` and `tournament_lobbies_enabled` off while doing
the setup below.

## Configure the beta Discord application

Use Scout's existing beta Discord application. Do not create a second bot or
OAuth application.

1. Add an Activity URL mapping on the beta Scout host whose root path is
   `/customs/`.
2. Keep the existing OAuth client secret. The backend uses
   `DISCORD_CLIENT_SECRET` for Activity code exchange and
   `JWT_SIGNING_SECRET` for the short-lived Customs session.
3. Re-authorize the beta bot with **Manage Channels** and **Move Members** in
   addition to its existing permissions. Do not change the production install.
4. Confirm the Activity opens only from a guild voice channel and reports the
   existing Scout application ID from `/api/customs/config`.

The Activity session lasts ten minutes. Refresh is bounded to two hours and
rechecks the Activity instance, live guild membership, and the feature policy.

## Register Tournament-V5

The beta database needs one durable registration for every live Tournament
region Customs will use. Run the registration script from an environment with
the beta `DATABASE_URL`, `RIOT_API_KEY`, and public callback configuration:

```bash
cd packages/scout-for-lol/packages/backend
bun run scripts/register-tournament-provider.ts \
  --mode=live \
  --region=AMERICA_NORTH
```

Registration is explicit and durable. A missing row is an error; Scout never
silently creates a replacement provider during `/lobby create` or a custom
night.

Before enabling either flag, use the existing `/lobby create` command to prove
that the beta Riot key can create a real code and that the Tournament poller
can read its events.

## Enable the initial guild

Target the existing beta guild in Flipt. Enable both flags for the same
`server` attribute:

- `tournament_lobbies_enabled` permits code creation.
- `custom_nights_enabled` exposes Activity authentication, mutations, socket
  delivery, and dashboard history.

Do not add a guild allowlist environment variable. Later expansion is another
Flipt target using the `server` attribute.

## Run and observe a night

1. Open Scout Customs in the configured beta voice lobby.
2. Start recruitment and verify the shared Scout bot posts the recruitment
   message in the launch channel.
3. Collect consent, select Riot accounts, lock ten players, choose captains,
   and finish the draft.
4. Create the Tournament lobby. Only the host and cohosts should see the code.
5. Arrange team voice, then start the game in League. Scout changes to
   `PLAYING` only after Tournament-V5 observes the game.
6. After the lobby resolves, expect `RESULT_PENDING`. There is no manual result
   action.
7. Wait for the ordinary Match-V5 cursor to archive the raw match in S3. In
   the same database transaction before the cursor advances, Scout marks the
   lobby `reported`, projects champions and wins, verifies the game, and opens
   intermission.
8. Choose one of the four intermission team/captain options and complete a
   second game.

Check the beta dashboard's Customs history after each game. It should show the
normalized game snapshot and the append-only audit revisions.

An unfinished night expires 12 hours after it starts. The beta Temporal
schedule checks once per minute, records `NIGHT_EXPIRED`, ends the night, and
releases the guild's active-night pointer so a later night can start. Treat
this as stale-night recovery, not a result path: expiry never chooses a winner
or verifies an unfinished game.

## Recover without inventing a result

- **Code remains pending:** retry the existing provisioning claim. An
  ambiguous Riot response is never permission to request another code.
- **Lobby is resolved:** do not retry Tournament-V5. The lobby waits for the
  normal Match-V5/S3 boundary. Repair match ingestion instead.
- **Voice provisioning failed:** use the Activity retry. Scout cleans up a
  partial channel pair before retrying.
- **Players remain in team channels:** use **Return everyone to lobby**. End
  night also performs that cleanup before removing the active-night pointer.
- **The host disappears:** wait for the 12-hour expiry if no manager can end the
  night. Confirm the audit contains `NIGHT_EXPIRED` and the guild can start a
  new night before intervening in PostgreSQL.
- **Riot never produces the match:** keep waiting while recovery remains
  possible, or have the host explicitly void the game. Never enter a winner
  manually.

The rollback is only to disable `custom_nights_enabled`. Leave the PostgreSQL
history and consent/audit rows intact.

## Related

- [Why Scout can only see custom games through the Tournament API](/explanation/scout-custom-games/)
- [Check the Flipt flag inventory](/how-to/check-flipt-flag-inventory/)
