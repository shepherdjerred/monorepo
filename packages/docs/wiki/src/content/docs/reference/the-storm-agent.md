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

Namespace `storm`, environment `prod`. Both default off; flipping needs no
plugin restart.

| Flag                           | Effect                                |
| ------------------------------ | ------------------------------------- |
| `storm-brain-classify-enabled` | `POST /v1/classify` answers; else 503 |
| `storm-brain-triage-enabled`   | `POST /v1/triage` answers; else 503   |

A 503 completes the plugin flow silently and records nothing.

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
| `StormBrainRequestErrors`    | warning  | Any `error` or `upstream_error` outcome in 15m          |
| `StormBrainRequestsRejected` | warning  | Any `invalid` or `unauthorized` outcome in 15m          |
| `StormBrainTargetDown`       | critical | Metrics endpoint unscrapeable for 5m                    |

## Service endpoints

The plugin calls the brain at `http://storm-brain.storm-brain.svc.cluster.local:3000`.
The contract, error table, and metrics live in `packages/storm-brain/README.md`.
