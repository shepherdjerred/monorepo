---
title: Durable agent chat ingress
description: HTTP and Discord contracts for starting, selecting, listing, and continuing Temporal-backed agent chats.
---

The Temporal gateway exposes one transport-neutral HTTP contract and one
dedicated Discord slash command for durable Claude Code and Codex chats.
iMessage automation uses the HTTP contract. The Discord adapter starts a
durable command Workflow that calls the same chat client; it does not create a
separate conversation store. See the
[HTTP adapter](https://github.com/shepherdjerred/monorepo/blob/fe62b26b0b0a306eee682e3f351bb9be47536d6d/packages/temporal/src/event-bridge/agent-chat-api.ts),
[Discord adapter](https://github.com/shepherdjerred/monorepo/blob/fe62b26b0b0a306eee682e3f351bb9be47536d6d/packages/temporal/src/event-bridge/agent-chat-discord.ts),
and [shared client](https://github.com/shepherdjerred/monorepo/blob/995f3d3ced2de1040a150e15aeb467a636269b4c/packages/temporal/src/lib/agent-chat-client.ts).

## Authentication and identity

HTTP requests use the existing `AGENT_TASK_API_TOKEN` bearer credential on
`temporal-agent-tasks.sjer.red`. The
[bearer validator](https://github.com/shepherdjerred/monorepo/blob/995f3d3ced2de1040a150e15aeb467a636269b4c/packages/temporal/src/event-bridge/http-auth.ts)
enforces this contract. Every request must include:

```text
Authorization: Bearer <token>
Content-Type: application/json
```

An ingress identity is transport-specific:

```json
{ "kind": "imessage", "conversationId": "bluebubbles-chat-guid" }
```

```json
{ "kind": "discord", "channelId": "123", "threadId": "456" }
```

`threadId` is omitted for a normal Discord channel. Selecting a chat updates
the active binding for that ingress identity. It never changes the chat's
provider or model. The
[shared schemas](https://github.com/shepherdjerred/monorepo/blob/995f3d3ced2de1040a150e15aeb467a636269b4c/packages/temporal/src/shared/agent/agent-chat.ts)
define both identities and immutable chat configuration.

## HTTP routes

The [HTTP route implementation](https://github.com/shepherdjerred/monorepo/blob/fe62b26b0b0a306eee682e3f351bb9be47536d6d/packages/temporal/src/event-bridge/agent-chat-api.ts)
defines these methods and response statuses.

- `GET /agent-chats` lists every cataloged chat.
- `GET /agent-chats/:chatId` reads one catalog entry.
- `POST /agent-chats` creates a chat, optionally with a first turn.
- `POST /agent-chat-turns` continues an explicit or actively bound chat.
- `GET /agent-chat-turns/:turnId` polls an accepted turn for its durable result.
- `POST /agent-chats/:chatId/bindings` makes a chat active for an ingress
  identity.

Explicit binding requests require `binding` and an ISO-8601 `submittedAt`:

```json
{
  "binding": { "kind": "imessage", "conversationId": "bluebubbles-chat-guid" },
  "submittedAt": "2026-09-14T22:00:00.000Z"
}
```

Retries retain the original `submittedAt`. An older operation cannot replace
a newer active binding.

Create a chat from iMessage:

```json
{
  "title": "Investigate storage alerts",
  "provider": "claude",
  "model": "claude-opus-5",
  "source": {
    "kind": "imessage",
    "conversationId": "bluebubbles-chat-guid"
  },
  "prompt": "Inspect the current alerts and summarize the likely cause.",
  "turnId": "bluebubbles-message-01J8ABCDEF"
}
```

Continue whichever chat is active in that iMessage conversation:

```json
{
  "source": {
    "kind": "imessage",
    "conversationId": "bluebubbles-chat-guid"
  },
  "prompt": "Check whether the affected volume recovered.",
  "turnId": "bluebubbles-message-01J8ABCDEG"
}
```

Set `chatId` on the same request to continue any cataloged scheduled,
iMessage, or Discord chat. That successful turn also makes the selected chat
active for the requesting ingress.

Every prompt-bearing HTTP request requires a globally unique, stable `turnId`.
Use the source message or delivery ID when it fits the accepted
letters/digits/underscore/dot/colon/hyphen format (200 characters maximum).
Retry the same delivery with the same ID. Temporal rejects a second execution
after the first settles and reuses an in-flight execution, so a network retry
does not execute another provider turn.

Prompt-bearing POSTs return `202 Accepted` immediately with the `turnId` and
Temporal `workflowId`. A create request without an explicit `chatId` derives a
stable chat ID from that turn ID, so retrying the POST cannot leave a second
empty chat behind. A prompt-less create must supply `chatId`; retrying it with
the same configuration reuses the original catalog entry and creation time.
Reusing either stable ID for different content returns `409 Conflict`. Poll
`GET /agent-chat-turns/:turnId`: it returns `202` while the turn is running and
`200` with either the completed turn result or a terminal failure status. The
provider turn, catalog update, and result survive the original HTTP request
and Cloudflare connection lifetime. The
[durable HTTP Workflow](https://github.com/shepherdjerred/monorepo/blob/995f3d3ced2de1040a150e15aeb467a636269b4c/packages/temporal/src/workflows/http-agent-chat.ts)
and [submission Activity](https://github.com/shepherdjerred/monorepo/blob/995f3d3ced2de1040a150e15aeb467a636269b4c/packages/temporal/src/activities/agent/chat/http-ingress.ts)
own that execution after acceptance.

Recurring schedules are not created through HTTP. Declare them in
`agent-chat-schedule-definitions.ts` so normal Temporal reconciliation owns
drift and retirement. The
[schedule catalog](https://github.com/shepherdjerred/monorepo/blob/995f3d3ced2de1040a150e15aeb467a636269b4c/packages/temporal/src/schedules/agent-chat-schedule-definitions.ts)
is the source of truth.

## Discord command

The dedicated bot registers one global `/agent` command:

- `/agent new provider:<claude|codex> prompt:<text>` starts a chat and binds it
  to the current channel or thread. `title` and `model` are optional.
- `/agent continue prompt:<text> [chat:<chatId>]` continues the active chat or
  selects any prior chat by ID. Unknown IDs are rejected before queuing.
- `/agent list` privately lists the 20 most recently updated chats.

Discord exposes the command only to members with the Administrator permission,
and the handler additionally requires the caller to own the server. This is an
operator-only homelab surface, not a shared subscription-backed bot. The
[command definition and authorization handler](https://github.com/shepherdjerred/monorepo/blob/fe62b26b0b0a306eee682e3f351bb9be47536d6d/packages/temporal/src/event-bridge/agent-chat-discord.ts)
enforce both checks.

Discord connects only when the control gateway receives
`AGENT_CHAT_DISCORD_TOKEN`. Without this bootstrap credential, the gateway starts
and logs that Discord ingress was skipped. The token must belong to the dedicated
durable-chat application, not another bot. Source:
[connector bootstrap](https://github.com/shepherdjerred/monorepo/blob/510efd00dde28f78d9ee1889a01a3efe9de798f4/packages/temporal/src/event-bridge/agent-chat-discord.ts).

The bot requests only the Discord `Guilds` intent. A slash interaction receives
an immediate private acknowledgement. Temporal then runs or continues the chat
and posts the result through a retrying delivery Activity on the credential-owning
gateway queue. Each chunk uses a Discord enforced nonce, so retrying an
ambiguous send does not duplicate a recent message. Provider output is split at
Discord's message limit and all user or role mentions are disabled. See the
[delivery Workflow](https://github.com/shepherdjerred/monorepo/blob/995f3d3ced2de1040a150e15aeb467a636269b4c/packages/temporal/src/workflows/discord-agent-chat.ts)
and [Discord delivery Activity](https://github.com/shepherdjerred/monorepo/blob/995f3d3ced2de1040a150e15aeb467a636269b4c/packages/temporal/src/activities/agent/chat/discord-ingress.ts).

## Error contract

HTTP returns `401` for a missing or incorrect bearer, `400` for malformed
input, `404` for an unknown catalog entry or turn handle, and `409` when a
stable chat or turn ID is reused for different content. Failures that occur
before durable submission return `500` and are reported through the gateway's
normal logs and error tracking. Provider, binding, Temporal, and storage
failures after submission appear as a terminal `failed` poll result; inspect
the corresponding Temporal execution for the detailed cause.
