---
title: Operate Scout custom nights
description: Configure the beta Discord Activity, pair local observers, run a custom night, and recover incomplete local observations.
sidebar:
  order: 12
---

This guide shows how to operate a beta custom night with normal League lobbies
observed by paired Scout Clients.

## 1. Configure the beta Discord application

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
rechecks the Activity instance, live guild membership, and feature policy.

## 2. Enable the guild and observers

Target the beta guild with `custom_nights_enabled` using its `server`
attribute. Confirm the global `scout_client_ingestion` kill switch is enabled.

Install Scout Client on the computers that will observe games. Three or four
observers are useful for a ten-player lobby, but one valid observation is
enough. Each observer must:

1. Open Scout Client and choose **Pair with Scout**.
2. Approve the device in the authenticated browser page.
3. Confirm the client shows both **League: Connected** and **Scout API:
   Paired** while League is open.
4. Enable **Start Scout Client at login** if the observer wants unattended
   collection.

Any Scout user can pair a client while the kill switch is enabled. Uploaded
player observations are accepted only when the local Riot account is linked to
the same Scout user.

## 3. Run and observe a night

1. Open Scout Customs in the configured beta voice lobby.
2. Start recruitment and verify the shared Scout bot posts the recruitment
   message in the launch channel.
3. Collect consent, select Riot accounts, lock ten players, choose captains,
   and finish the draft.
4. Have any player create a normal custom lobby in League and invite the two
   assigned teams.
5. Keep at least one paired Scout Client running. Scout binds the lobby after
   its exact roster matches the pending game.
6. Play the game and keep the client open through the post-game screen.
7. Wait for the match workflow to archive a complete result. Riot data is
   preferred. Complete local data can fill the gap after two minutes.
8. Confirm the game becomes `VERIFIED`, intermission opens, and a completed
   ROFL is uploaded when League saved one.
9. Choose an intermission team or captain option before the next game.

Check Customs history after each game. It should show the normalized game
snapshot and append-only audit revisions.

An unfinished night expires 12 hours after it starts. After durable cutover,
the Temporal schedule queues an expiry operation. The gateway returns voice
members and removes recorded team channels before ending the night and
releasing the active-night pointer. Inspect `OPERATION_COMPLETED` with action
`expire`; legacy nights retain their original `NIGHT_EXPIRED` audit records.
Expiry never chooses a winner or verifies an unfinished game.

If voice creation is held for inspection when the night expires, Scout ends
the night and releases the guild for a new night immediately. It preserves the
uncertain creation and recorded channels for manager review. The unfinished
game becomes `VOID`; voice cleanup remains pending until the uncertainty is
resolved. Inspect `NIGHT_EXPIRED` with `cleanupHeld: true` and then the cleanup
operation's `OPERATION_COMPLETED` record.

## 4. Recover without inventing a result

- **No lobby binds:** verify every selected Riot account, then compare the
  League roster with the pending game's exact roster. Resolve duplicate pending
  games instead of guessing.
- **Observations remain queued:** keep Scout Client running and check its last
  typed error. The SQLite outbox retries the same immutable observations.
- **Riot has no result:** keep one observer online through postgame. Repair the
  local upload or void the game explicitly; never enter a winner manually.
- **Replay does not upload:** confirm League finished writing the ROFL and that
  the same device supplied accepted postgame evidence for its game ID.
- **Voice provisioning is pending:** leave the Activity open or reconnect.
  Scout resumes from persisted channels and participant checkpoints.
- **Recruitment was refused by Discord:** repair the bot's channel permissions,
  then make a normal night update. A confirmed permission or missing-target
  failure permits a new recruitment generation, with the original failure
  retained in history. Pending, delivered, and uncertain attempts are not
  automatically replaced.
- **Voice setup needs a check:** a host, cohost, or administrator must inspect
  the server's current channels. Enter the exact channel Scout created, or
  leave its ID empty after verifying no matching channel exists. Describe the
  check and submit the answer. Scout verifies fresh channel evidence before
  resuming. Night controls remain disabled until the operation finishes.
- **Expired night needs voice cleanup:** inspect the channels as above, then
  choose **Record channel and clean up** or **Confirm no channel and clean
  up**. Scout returns players and removes its recorded team channels. It does
  not create another channel or resume the expired game, and it leaves any
  newer night in the guild active. Reopen the Activity to see pending cleanup
  for nights you host or cohost; administrators can recover any night in the
  server. These controls remain available alongside a new active night.
- **Players remain in team channels:** use **Return everyone to lobby**. Ending
  the night also performs that cleanup.
- **The host disappears:** wait for expiry if no manager can end the night.
  Inspect the expiry operation, its gateway Activity, and its final audit
  record before intervening in PostgreSQL.

Rollback requires disabling `custom_nights_enabled` for the guild. Disable the
global `scout_client_ingestion` kill switch only when all native ingestion must
stop. Leave PostgreSQL history, observations, consent, and audit rows intact.

## Related

- [Why Scout observes League locally](/explanation/scout-custom-games/)
- [Check the Flipt flag inventory](/how-to/check-flipt-flag-inventory/)
