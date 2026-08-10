---
title: Home automation routines
description: Triggers, timings, guards, and parameters for every household routine the worker runs.
sidebar:
  order: 4
---

Parameters for the presence-driven and wall-clock routines. Source:
[`src/workflows/ha/`](https://github.com/shepherdjerred/monorepo/tree/main/packages/temporal/src/workflows/ha).

## Presence routines

| Routine          | Trigger             | Settle       | Presence guard                                | Actions                                                                      |
| ---------------- | ------------------- | ------------ | --------------------------------------------- | ---------------------------------------------------------------------------- |
| `welcome-home`   | any arrival         | 90 s         | first arrival to empty house for the greeting | greeting, dock running vacuums, living-room scene, entry lights after sunset |
| `leaving-home`   | last departure      | 90 s         | house must be empty                           | notification, all lights off with per-light verification, vacuum run         |
| `reconcile-lock` | every presence edge | rolling 90 s | reads live occupancy                          | deadbolt, only when current ≠ desired                                        |

`reconcile-lock` is a singleton: every presence transition does a
`signalWithStart` on the fixed workflow ID. Each signal restarts the quiet
window. Neither `welcome-home` nor `leaving-home` touches the lock.

## Good morning

Three schedules per day type, weekday and weekend variants.

| Phase   | Timing               | Guard                                                 | Actions                                                                           |
| ------- | -------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------- |
| Preheat | 2 h 15 m before wake | nobody home → skip; indoor ≤ 20 °C or outdoor ≤ 15 °C | bathroom floor heat in presence-checked 15-minute chunks                          |
| Wake    | wake time            | nobody home → skip                                    | notification, bedroom music with volume ramp, dim scene, thermostat off after 1 h |
| Get-up  | wake + 15 m          | nobody home → skip                                    | brighten room, join bathroom speaker to the music group                           |

Outdoor temperature comes from Open-Meteo; Home Assistant has no weather
integration. Wake re-asserts heat, so it works standalone if preheat was paused.

## Vacuum

| Routine                  | Times               | Guard         |
| ------------------------ | ------------------- | ------------- |
| `run-vacuum-if-not-home` | 09:00, 12:00, 17:00 | everyone away |

Starts idle or docked units, then verifies concurrently that they began
cleaning. An anomalous unit state throws non-retryably.

## Sleep routines

Started by the authenticated Temporal sleep webhook, not Home Assistant.

| Routine       | Default | Range        | Actions                                                         |
| ------------- | ------- | ------------ | --------------------------------------------------------------- |
| `good-night`  | —       | once per day | dim bedroom if lit, sleep playlist with a nine-step volume ramp |
| `sleep-music` | 180 min | 1–1440 min   | bedroom speaker to 10%, play sleep favorite, stop at deadline   |
| `sleep-ac`    | 120 min | 1–1440 min   | `climate.bedroom` to 24 °C cooling, off at deadline             |

`good-night` has no presence guard: an explicit user action is its own
authorization.

### Sleep webhook

| Endpoint                                           | Body                             |
| -------------------------------------------------- | -------------------------------- |
| `POST https://temporal-sleep.sjer.red/sleep/music` | `{ "duration_hours": <number> }` |
| `POST https://temporal-sleep.sjer.red/sleep/ac`    | `{ "duration_hours": <number> }` |

Headers: `Authorization: Bearer <SleepWebhookToken>` and
`Content-Type: application/json`.

The webhook converts hours to minutes and rounds, then restarts the fixed
workflow ID when a new invocation arrives.

## Related

- [How to build the sleep Shortcut](/how-to/build-the-sleep-shortcut/)
- [Event-driven surfaces](/explanation/temporal/event-surfaces/) — how presence
  events reach the worker
