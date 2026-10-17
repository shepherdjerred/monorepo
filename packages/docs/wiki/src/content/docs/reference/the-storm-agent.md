---
title: The Storm agent reference
description: Commands, permissions, config keys, flags, and schedules for the AI staff agent.
sidebar:
  order: 25
---

Facts for operating the AI staff. Behavior and rollout live in
[The Storm AI staff](/explanation/the-storm-ai-staff/); the review loop is in
[Review AI staff decisions](/how-to/review-ai-staff-decisions/).

## Commands

All staff commands need `thestorm.agent.staff`.

| Command                       | Who      | Effect                                                                         |
| ----------------------------- | -------- | ------------------------------------------------------------------------------ |
| `/agent decisions [p]`        | staff    | Newest 10 decision rows, optionally for one player                             |
| `/agent sweep`                | staff    | Run the stale-ticket sweep now; reports counts                                 |
| `/agent overturn <id>`        | player   | Reverse decision `<id>`; lifts mutes, dismisses escalations                    |
| `/agent endorse <id>`         | player   | Mark decision `<id>` reviewed-as-good; clears it from review                   |
| `/agent case <id>`            | staff    | Assemble ticket `<id>`: triage, trail, standing, precedents                    |
| `/agent faq <ticket> [entry]` | staff    | Answer a ticket from the FAQ catalog; the named entry or the match             |
| `/escalations`                | staff    | Escalations plus sampled spot-checks; reviewed rows are gone                   |
| `/ticket …`                   | everyone | File, view, claim, comment, resolve; staff verbs need `thestorm.tickets.staff` |

`/agent overturn` and `/agent endorse` need a player sender: console and RCON
cannot record a reviewer. `/agent case` and `/agent faq` work from console.

## Permissions

| Node                     | Grants                                                         |
| ------------------------ | -------------------------------------------------------------- |
| `thestorm.agent.staff`   | All `/agent` verbs and `/escalations`                          |
| `thestorm.tickets.staff` | Staff-only comments, claim, resolve, escalate, view any ticket |

## agent.yml

Content admission is owned by Safety. The agent retains ticket triage, sampled
review rows and human review commands. Unscreened Global publications retain its
legacy chat prefilters and ladders while the Safety rollout is disabled or absent.
Screened publications supply context without repeating legacy enforcement.

The owned file is `packages/the-storm/server/owned/plugins/TheStorm/agent.yml`.
Every key is required; unknown keys stop the module.

| Section      | Keys                                                                                                                         |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| top level    | `mode` (`shadow` or `active`), `classifyThreshold`, `triageThreshold`, `resolveThreshold`, `reviewSamplePercent`, `serverId` |
| `prefilters` | Burst, caps, arc, and rate-trip limits plus `shadowLog`                                                                      |
| `ladders`    | Per-offense rungs (`offenseId`, `windowMinutes`, `steps`, `topAction`)                                                       |
| `brain`      | `baseUrl`, `bearerTokenEnv`, `timeoutMs` (1000–300000)                                                                       |
| `sweep`      | `intervalMinutes` (1–1440), `redriveAfterMinutes`, `redriveBackoffMinutes`, `slaAfterMinutes` (0–10080)                      |
| `faq`        | `enabled`, `halfLifeHours` (1–720), `entries` with `id`, `keywords`, `reply`, `link` (blank when none)                       |
| `onboarding` | `enabled`, `lines` (1–8 when enabled, one chat line each)                                                                    |

The brain token never lives in the file: `bearerTokenEnv` names the
environment variable that holds it, and the module refuses to start without
it.

## Flipt flags

Namespace `storm`, environment `prod`. Classification and triage are always
on; the brain gates only conversation (`storm-brain-conversation-enabled`).

| Flag                | Effect                                                     |
| ------------------- | ---------------------------------------------------------- |
| `storm-brain-model` | Selects the model on brain startup; restart brain to apply |

A 503 completes the plugin flow silently and records nothing.

## Content admission

The source of truth is the [Storm server configuration](https://github.com/shepherdjerred/monorepo/tree/main/packages/the-storm/server).

| Boundary                                      | Behavior                                                                                                                 |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Screening rollout                             | `the-storm-content-safety-enabled`, namespace `the-storm`; production default off, beta on                               |
| Correction rollout                            | `the-storm-anticheat-corrections-enabled`; default off in both environments                                              |
| New text                                      | Held until approved; outage rejects without a misconduct strike                                                          |
| Private evidence                              | Allowed and blocked attempts, components, scores, decisions and receipts retained indefinitely                           |
| Evidence access                               | `thestorm.safety.evidence`; `/safety search` in game, authenticated `toolkit mc evidence` for complete JSON and exports  |
| Ordinary length                               | Filter accepts 2,000 code points; command transport 4,096 characters; vanilla chat UI 256                                |
| Explicit slur or identical repeated-link spam | Block plus ten-minute mute; another clear offense within seven days gets one hour                                        |
| Cold advertising                              | First confirmed offense blocked with explanation; repeat after a recorded warning within 24 hours may get the short mute |
| Ambiguous or model-only offense               | Publication withheld for review; no automatic mute                                                                       |
| Bans                                          | Human decision                                                                                                           |
| Saved-content snapshots                       | Loaded signs, container metadata and entity names; creator unknown, no observer offense                                  |
| Anticheat scope                               | Grim records Java findings and game context; Floodgate players are exempt                                                |
| Xray                                          | Paper mode 3 with air and Overworld ore heights; Nether ancient debris; authored arenas excluded                         |
| Visual content                                | Map art and builds use activity evidence and human review; no image classifier                                           |

`safety.yml` supplies the brain bootstrap and bounded transport settings. CoreProtect
owns block/item rollback, while Safety owns redacted player text. The current LiveMap
can still expose underground areas.

See [review safety evidence](/how-to/review-the-storm-safety-evidence/) for the private review and export workflow.

## Schedules

| Schedule           | Cadence                                              | Source      |
| ------------------ | ---------------------------------------------------- | ----------- |
| Stale-ticket sweep | `sweep.intervalMinutes` (default 15) plus every boot | `agent.yml` |

## Alerts

PrometheusRule `prometheus-storm-brain-rules` watches the brain's metrics and
routes to the alert dashboard plus operator email. Thresholds are starting
points: re-derive the cost floor from measured spend after the shadow soak.

| Alert                        | Severity | Fires when                                              |
| ---------------------------- | -------- | ------------------------------------------------------- |
| `StormBrainCostSpike`        | warning  | Hourly cost tops 5× its 24h rate and $0.10/hour for 15m |
| `StormBrainLatencyHigh`      | warning  | p95 request latency tops 30s for 15m                    |
| `StormContentScreeningSlow`  | warning  | Content screening p95 exceeds 3s for 10m                |
| `StormBrainRequestErrors`    | warning  | Any `error` or `upstream_error` outcome in 15m          |
| `StormBrainRequestsRejected` | warning  | Any `invalid` or `unauthorized` outcome in 15m          |
| `StormBrainTargetDown`       | critical | Metrics endpoint unscrapeable for 5m                    |

## Service endpoints

The plugin calls the brain at `http://storm-brain-service.storm-brain.svc.cluster.local:3000`.
The contract, error table, and metrics live in `packages/storm-brain/README.md`.
