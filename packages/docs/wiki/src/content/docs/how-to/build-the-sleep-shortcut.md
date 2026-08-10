---
title: Build the sleep Shortcut
description: Wire an iOS Shortcut to the Temporal sleep webhook so Siri can start a timed music or AC routine.
sidebar:
  order: 7
---

The Shortcut collects a duration and posts it. Temporal owns the timer and the
device orchestration, so the routine survives a worker restart and your phone
leaving the network.

Build one Shortcut per routine.

## 1. Create the Shortcut

Add two actions, in order.

1. **Ask for Input** — type Number, prompt "How many hours?"
2. **Get Contents of URL** — method `POST`, the URL for your routine.

## 2. Set the headers

On the Get Contents of URL action:

| Header          | Value                        |
| --------------- | ---------------------------- |
| `Authorization` | `Bearer <SleepWebhookToken>` |
| `Content-Type`  | `application/json`           |

## 3. Set the body

Request body, for either routine:

```json
{
  "duration_hours": "<ShortcutInput>"
}
```

Send hours. The webhook converts to minutes and rounds; you do not convert in
the Shortcut.

## 4. Pick the URL

| Routine | URL                                           |
| ------- | --------------------------------------------- |
| Music   | `https://temporal-sleep.sjer.red/sleep/music` |
| AC      | `https://temporal-sleep.sjer.red/sleep/ac`    |

## 5. Name it for Siri

Name each Shortcut for the phrase you want to say — "Sleep music", "Sleep AC".
The name is the Siri trigger.

## Behaviour worth knowing

Accepted durations are 1–1440 rounded minutes. Outside that range the webhook
rejects the request.

Each routine uses a fixed workflow ID, so invoking it again **restarts** the
routine rather than stacking a second timer. Asking for three hours and then
one hour gives you one hour, counted from the second request.

## Related

- [Home automation routines](/reference/home-automation-routines/) — defaults and actions
- [Event-driven surfaces](/explanation/temporal/event-surfaces/) — why this is a webhook and not Home Assistant
