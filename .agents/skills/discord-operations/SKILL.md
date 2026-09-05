---
name: discord-operations
description: Read, send, or verify Discord messages and bot interactions through this repository's toolkit Discord daemon. Use for live Discord operations, slash commands, rendered embeds, components, or bot acceptance.
---

# Discord operations

Use `toolkit discord` and its session daemon rather than ad-hoc scripts. Verify
the configured identity, guild, channel, and bot before sending anything.

Reads and fixture rendering are safe starting points. A send, interaction,
reaction, moderation action, or slash-command invocation is an external write;
it needs a user-authorized target and payload.

For bot changes:

- exercise the real fixture or test harness first;
- render the embed, components, mentions, and error state as Discord sees them;
- preserve guild/user authority from trusted runtime context, not model input;
- never log tokens or raw private conversation history;
- distinguish API acceptance, message delivery, interaction handling, and
  downstream side effects.

Capture the smallest real rendered message or interaction that proves a visual
change and attach it to the PR. Stop the session daemon when its owning workflow
ends if it was started only for that task.
