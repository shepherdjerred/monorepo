---
title: Diagnose Streambot sports playback
description: Separate provider discovery, media decoding, and Discord delivery failures without exposing private media sessions.
---

Use this procedure when a listed sports event cannot start or stops during playback.

## 1. Check the deployed service

Inspect Streambot and its shared browser:

```bash
kubectl get pods -n media -l app=streambot
kubectl get pods -n pinchtab
toolkit argocd app get media
```

Compare the deployed image with the intended release before reproducing.
A ready pod or synced application establishes deployment health, not playable media.
The [Streambot deployment](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/cdk8s/src/resources/streambot/streambot.ts)
owns its browser bootstrap and media tools.

## 2. Locate the failed request

Find sports resolution records around the request time:

```bash
toolkit loki query '{namespace="media"} | json | module="sports"' --since 30m --limit 50
```

Record the public event URL, provider, request time, and redacted failure.
The [selection boundary](https://github.com/shepherdjerred/monorepo/blob/main/packages/streambot/src/sports/playback-selection.ts)
logs resolution failures before presenting the listener's response.
Keep browser response captures, signed media URLs, session headers, and content keys private.

## 3. Reproduce through the media harness

Use a currently live event and the configured dedicated test guild with an empty voice channel.
From `packages/streambot`, run the
[sports harness](https://github.com/shepherdjerred/monorepo/blob/main/packages/streambot/e2e/sports-live.ts)
with the existing credential wrapper and configured harness inputs:

```bash
bun run e2e:sports
```

Distinguish successful browser discovery, ffprobe audio/video recognition, and actual Discord delivery.
Confirm picture and sound in Discord; frame counters alone do not establish receiver quality.
Stop the harness after collecting the result and verify it leaves the voice channel.

## 4. Check browser capability failures

For `network_intercept_disabled`, compare the deployed browser configuration with the
[declared PinchTab configuration](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/cdk8s/src/resources/pinchtab/index.ts).
Response inspection is a shared daemon capability, including for its other authenticated clients.
Reconcile configuration through GitOps rather than editing the live browser dashboard.
Do not disable its firewall or content scanning to inspect a failed source.

## Related

- [Streambot transports](/explanation/streambot-transports/)
- [Diagnose Streambot voice](/how-to/diagnose-streambot-voice/)
