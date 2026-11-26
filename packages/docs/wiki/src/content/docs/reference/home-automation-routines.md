---
title: Home automation routines
description: Triggers, timings, guards, and parameters for every household routine the worker runs.
sidebar:
  order: 4
---

Parameters for the presence-driven and wall-clock routines. Source:
[`src/workflows/ha/`](https://github.com/shepherdjerred/monorepo/tree/main/packages/temporal/src/workflows/ha).

## Pet-care alerts

The event bridge signals the singleton `petCareAlerts` workflow for changes to
the raw pet-care sensors. Temporal applies these holds and delivers each
incident to Home Assistant, Jerred’s iPhone, and Alertmanager.

| Sensor condition             | Hold   |
| ---------------------------- | ------ |
| Litter-Robot problem         | 5 min  |
| Litter-Robot stalled         | 45 min |
| Either PetLibro feeder issue | 5 min  |
| Fountain water below 650 mL  | 15 min |
| Fountain operation problem   | 5 min  |

Only a confirmed `off` state resolves an incident. Unknown or unavailable
state cancels a pending hold and preserves an active incident.

## Presence routines

| Routine             | Trigger             | Settle       | Presence guard                                | Actions                                                                      |
| ------------------- | ------------------- | ------------ | --------------------------------------------- | ---------------------------------------------------------------------------- |
| `welcome-home`      | any arrival         | 90 s         | first arrival to empty house for the greeting | greeting, dock running vacuums, living-room scene, entry lights after sunset |
| `leaving-home`      | last departure      | 90 s         | house must be empty                           | notification, all lights off with per-light verification, vacuum run         |
| `reconcile-lock`    | every presence edge | rolling 90 s | reads live occupancy                          | deadbolt, only when current ≠ desired                                        |
| `reconcile-climate` | every presence edge | rolling 90 s | reads live occupancy                          | bedroom and living-room heat for the current clock                           |

"Away" depends on the routine. Source:
[`presence.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/temporal/src/shared/infra/presence.ts).

| Person state               | Vacuum, arrival, departure, and occupied-heat off | `reconcile-lock` |
| -------------------------- | ------------------------------------------------- | ---------------- |
| `home`                     | home                                              | home             |
| `not_home` or a named zone | away                                              | away             |
| `unknown` or `unavailable` | home                                              | away             |

`reconcile-lock` and `reconcile-climate` are singletons. Every presence
transition does a `signalWithStart` on each fixed workflow ID, and each signal
restarts that workflow's quiet window. Neither `welcome-home` nor
`leaving-home` touches the lock or the heat.

## Good morning

One clock every day. Weekday and weekend schedules share it.

| Phase   | Time  | Guard                                                 | Actions                                                       |
| ------- | ----- | ----------------------------------------------------- | ------------------------------------------------------------- |
| Preheat | 08:00 | nobody home → skip; indoor ≤ 20 °C or outdoor ≤ 15 °C | bathroom floor to 30 °C, in presence-checked 15-minute chunks |
| Wake    | 09:00 | nobody home → skip                                    | notification, bedroom music with volume ramp, dim scene       |
| Get-up  | 09:15 | nobody home → skip                                    | brighten room, join bathroom speaker to the music group       |

The floor turns off at 10:00. Wake re-asserts floor heat, so it still runs if
preheat was skipped. Outdoor temperature comes from Open-Meteo; Home Assistant
has no weather integration.

## Occupied heat

`climate.bedroom` and `climate.living_room` only. Office, guest room, guest
bath, and the bathroom floor stay on their own routines. Source:
[`climate-policy.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/temporal/src/workflows/ha/climate-policy.ts).

| Clock, someone home | Bedroom    | Living room |
| ------------------- | ---------- | ----------- |
| 00:00–08:00         | 18 °C heat | heat off    |
| 08:00–24:00         | 21 °C heat | 21 °C heat  |

| Condition                     | Both rooms      |
| ----------------------------- | --------------- |
| Everyone confirmed away       | heat off        |
| Mode is `cool`                | left as-is      |
| Already at the phase setpoint | no service call |

A warm room on a warm day is not switched into heat. Outdoor temperature is
Open-Meteo at `zone.home`. If that read fails, a unit already in `heat` still
follows the clock. A unit that is off enters heat only when the room is below
the phase setpoint.

| Schedule id             | Time  | Workflow               |
| ----------------------- | ----- | ---------------------- |
| `climate-sleep-setback` | 00:00 | `applyClimateSchedule` |
| `climate-day-start`     | 08:00 | `applyClimateSchedule` |
| `climate-wake-reassert` | 09:00 | `applyClimateSchedule` |

`climate-wake-reassert` repeats the 08:00 decision when midnight or the day
start was skipped. Presence edges use `reconcile-climate` in the table above.

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
