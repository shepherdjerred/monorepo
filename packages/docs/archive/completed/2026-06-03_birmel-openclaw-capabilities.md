---
id: reference-completed-2026-06-03-birmel-openclaw-capabilities
type: reference
status: complete
board: false
---

# Birmel OpenClaw-Like Capability Upgrade

## Summary

Implement a Birmel-native expansion of durable automation, web/browser tools,
agent sessions, richer memory, and GPT-5.5 configuration while keeping
VoltAgent, Discord.js, Prisma, and the existing specialist-agent routing model.

## Implementation Notes

- Add persistent `AgentJob`/`AgentJobRun` scheduling with run history and keep
  legacy `ScheduledTask` rows readable during migration.
- Add `AgentSession`/`AgentSessionEvent` for Discord-thread-aware agent session
  state and steering.
- Add `AgentMemory` for scoped durable memory records in addition to VoltAgent
  working/conversation memory.
- Make PinchTab the primary browser backend, with Playwright retained as a
  fallback provider.
- Upgrade Birmel's default primary model to `gpt-5.5` and add reasoning effort
  plus verbosity config.
