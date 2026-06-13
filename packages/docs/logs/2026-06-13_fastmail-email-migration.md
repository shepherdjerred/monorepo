# Fastmail Email Migration Batch

## Status

In Progress

## Progress

| Service  | Target email        | Status      | Notes                                                  |
| -------- | ------------------- | ----------- | ------------------------------------------------------ |
| Amazon   | `amazon@sjer.red`   | Not Started | First high-volume sender.                              |
| Experian | `experian@sjer.red` | Not Started | Identity/finance-sensitive; pause on unclear prompts.  |
| GitHub   | `github@sjer.red`   | Not Started | Developer account; avoid org/security setting changes. |
| OpenAI   | `openai@sjer.red`   | Not Started | Avoid API/project/billing changes.                     |
| Schwab   | `schwab@sjer.red`   | Not Started | Finance-sensitive; pause on unclear prompts.           |

## Session Log - 2026-06-13

### Done

- Started execution of the first high-volume Gmail-to-Fastmail catch-all migration batch.
- Created a fresh isolated headed PinchTab profile for this work.
- Started a persistent shell for 1Password CLI operations.
- Switched from the initial single-worker browser to one shared headed PinchTab browser for five parallel subagents.
- Created shared PinchTab profile `prof_57ffd509` and shared instance `inst_9388dd2a`.
- Assigned one service-specific tab to each subagent: Amazon, Experian, GitHub, OpenAI, and Schwab.

### Remaining

- Migrate Amazon, Experian, GitHub, OpenAI, and Schwab to their `@sjer.red` catch-all addresses.
- Verify each account change and update the corresponding 1Password item after successful verification.

### Caveats

- Do not record credentials, TOTP codes, session tokens, or verification links in this log.
- Use read-only local mail inspection for verification messages.
- Subagents must not use PinchTab shorthand commands; each subagent is restricted to its assigned tab in the shared browser.
