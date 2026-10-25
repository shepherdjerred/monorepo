---
title: How to enable scheduled LoL playback
description: Activate Streambot's official LoL schedules and one-time automatic playback through Temporal.
---

Activate scheduled LoL playback after Streambot's internal listener and dedicated Temporal worker are healthy.

1. Verify the dedicated scheduler credential exists in the configured password manager.
   The [Streambot deployment](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/cdk8s/src/resources/streambot/streambot.ts)
   projects the same credential into the listener and the isolated Temporal Activity worker.
   Run the homelab `check:1password` script after refreshing credential metadata.
2. Deliver the Streambot and Temporal changes through the [homelab release workflow](/how-to/cut-a-homelab-release/).
   Verify both deployments are ready, the `streambot` queue has an Activity poller, and the internal reconciliation request succeeds.
   Keep the automatic Schedule paused until these checks pass.
3. Enable the existing sports gate and the LoL browsing and automatic-playback gates for the intended beta server.
   The [managed flag inventory](https://github.com/shepherdjerred/monorepo/blob/main/packages/feature-flags/FLAG-INVENTORY.md)
   owns their exact names and targeting.
4. Unpause the declarative Schedule in the production namespace:

   ```bash
   toolkit temporal --namespace prod schedule toggle --unpause --schedule-id streambot-lol-playback --reason 'Scheduler listener and isolated Activity worker verified'
   ```

5. Join the dedicated test voice channel. In Streambot's sports tab, choose **LoL Esports** and an upcoming series.
   Select **Schedule playback** and verify the recorded channel and video slot.
   Keep another item playing to verify the schedule waits for an idle slot.
6. With a listener present and the slot idle, verify actual Discord audio and video when the series becomes live.
   Cancel the schedule and confirm unrelated queued media and video slots remain intact.
   Inspect a completed series to verify its schedule terminates without starting a later broadcast.

To disable future automatic starts, turn off the automatic-playback gate.
Leave reconciliation running so it can stop already playing series when they finish.
Cancel an individual schedule from **Your scheduled series** or the Discord schedule commands in the
[package reference](https://github.com/shepherdjerred/monorepo/blob/main/packages/streambot/README.md).

## Related

- [Web remote architecture](/explanation/streambot-web-remote/)
- [Web remote activation](/how-to/enable-streambot-web-remote/)
