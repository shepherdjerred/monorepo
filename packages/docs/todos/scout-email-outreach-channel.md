---
id: scout-email-outreach-channel
type: todo
status: planned
board: true
verification: agent
disposition: active
source_marker: false
---

# Add the Scout email outreach channel (Postal)

Deferred from the adoption/outreach PR (#2023), which shipped the four other
commits. Email was scoped by the requester as "an extra"; the primary asks (web
UI feedback, outreach rework, instrumentation, web fixes) all landed.

## Context

The target segment is narrow and deliberate: an installer who **signed into the
web dashboard** (so we can obtain an address via OAuth) and whose guild still has
**zero subscriptions and zero active competitions after 30 days**. One email,
ever.

It must consume the same
`NON_CORE_MESSAGE_BUDGET` as the DM ladder (`packages/scout-for-lol/packages/backend/src/discord/utils/message-budget.ts`).
Every non-core message prints "Message N of 3"; a fourth message arriving by a
different channel would make that text a lie. `GuildInstall.emailNudgeSentAt`
already exists for this and is currently unused.

## Remaining

- [ ] Extract `packages/temporal/src/shared/postal.ts` into a new workspace
      package (e.g. `packages/postal-client`) and repoint temporal's six import
      sites (`src/activities/{agent-task-side-activities,data-dragon,deps-summary,homelab-audit,scout-queue-windows}.ts`,
      `scripts/run-homelab-audit-local.ts`) plus `postal.test.ts`. Copying instead
      would duplicate logic the repo's `duplication-check` flags. The client
      already handles Postal returning **HTTP 200 on validation errors** — do not
      lose that.
- [ ] Add `"email"` to the single web-login scope array in `handleDiscordStart`
      (`packages/scout-for-lol/packages/backend/src/trpc/auth-web.ts`, currently
      `["identify", "guilds"]`). Extend `DiscordUserSchema` with
      `email: z.string().nullable().optional()` and `verified: z.boolean().optional()`
      — **optional**, because sessions predating the scope won't carry them.
      Persist in the existing `prisma.user.upsert` in `handleDiscordCallback`.
- [ ] Migration adding `User.email` / `User.emailVerified`. There is no backfill:
      addresses arrive only as users re-authenticate.
- [ ] Add a login-scope assertion to `auth-web.test.ts` (it asserts the _install_
      scope but has no login equivalent).
- [ ] Send via Postal's **HTTP API**, not SMTP. Scout's egress NetworkPolicy
      already allows 443 to `0.0.0.0/0`, so the API path needs zero netpol
      changes; SMTP would require editing both scout egress and the
      `postal-smtp-netpol` ingress allowlist, which does not list scout.
- [ ] Config keys in `configuration.ts` — note it requires touching **both** the
      `computeConfiguration()` literal **and** the hand-written getter mirror.
      Wire secrets in `packages/homelab/src/cdk8s/src/resources/scout/index.ts`.
- [ ] `scout_email_sent_total{kind,status}` metric, matching the outreach metrics.
- [ ] Tests: budget is shared with DMs (an email must not push a guild past 3),
      and the segment predicate excludes configured guilds.

## Comment Log

- 2026-08-08 — Deferred from PR #2023. The DM ladder, budget enforcement,
  transparency footer, web feedback prompt, and instrumentation all shipped; the
  budget model and `emailNudgeSentAt` column were built to accommodate this
  channel, so the remaining work is additive rather than a redesign.
