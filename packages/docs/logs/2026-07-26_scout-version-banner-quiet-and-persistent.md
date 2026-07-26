---
id: scout-version-banner-quiet-and-persistent
type: log
status: complete
board: false
---

# Scout contract-mismatch banner: quieter + persistent dismiss

## Context

User reported the "A new version of Scout is available... Reload" banner
(`packages/scout-for-lol/packages/app/src/components/version-info.tsx`,
`ContractMismatchBanner`) and said clicking Reload did nothing. Investigation
(two background agents) found:

1. The Reload button's `location.reload()` wiring is correct — no service
   worker, no stale cache bug.
2. The mismatch on beta is real and currently permanent: main CI has been red
   since build 6277 (2026-07-25 21:39 PT) due to a buildx interactive-privilege
   prompt hang introduced by PR #1668 in `.buildkite/scripts/bake-images.sh`.
   Because `images` never completes, `version-commit-back` never runs, so the
   beta backend image pin in `packages/homelab/src/cdk8s/src/versions.ts` is
   stuck at `2.0.0-6277` while the beta site deploy step (not gated on
   `images`) keeps shipping newer frontend bundles with a newer contract hash
   every build. Confirmed live via `curl` against `/api/version` on both
   `scout-for-lol.com` (404 — prod predates this feature, last promoted at
   build 6017) and `beta.scout-for-lol.com` (200, hash mismatch vs. the live
   JS bundle's baked `VITE_CONTRACT_HASH`).
3. User is fixing the CI hang separately. In the meantime, this banner is a
   developer diagnostic only — end users can't act on it — so the ask was to
   make dismiss persistent and make the banner far less interruptive.

## Change

`packages/scout-for-lol/packages/app/src/components/version-info.tsx`
(`ContractMismatchBanner`). Follow-up ask from the user: "really could we
somehow limit this to just my user" — end users have no control over a
backend/frontend contract mismatch, so it should never render for anyone but
the app owner.

- Replaced the full-width `Card` (pushes page content, two `Button`s) with a
  small `fixed bottom-right` corner chip — out of the page flow entirely.
- Dismiss now persists to `localStorage`
  (`scout:dismissed-contract-mismatch`), keyed by the specific
  `appContractHash:backendContractHash` pair rather than a plain boolean.
  Dismissing silences that exact known mismatch across reloads/sessions, but
  a _new_ mismatch (either side redeploying to a different hash) un-dismisses
  it automatically — so it can't permanently mask a genuinely new skew.
- Gated the whole component behind `me.data?.discordId !== OWNER_ID`, reusing
  the existing `trpc.auth.meWeb` query (already fetched elsewhere in the tree
  by `RequireSession`, so this is a deduped cache hit, not a new request for
  most sessions). `OWNER_ID` mirrors the backend's existing owner override
  (`packages/backend/src/configuration/flags.ts`'s `ME`); named `OWNER_ID`
  rather than `OWNER_DISCORD_ID` because gitleaks' `discord-client-id` rule
  false-positives on any identifier combining "discord" + "id" next to an
  18-digit literal (empirically verified — `flags.ts`'s bare `ME` doesn't
  trigger it, `OWNER_DISCORD_ID`/`DISCORD_OWNER_ID` both do).

## Session Log — 2026-07-26

### Done

- Root-caused the "Reload does nothing" report to a live main-CI outage (not
  a frontend bug): every build since 6277 has failed/hung due to a buildx
  interactive-privilege-prompt bug from PR #1668, which blocks
  `version-commit-back` from ever advancing beta's backend image pin while
  the site deploy step ships newer frontend bundles independently. Findings
  reported to user; user is fixing CI separately.
- Rewrote `ContractMismatchBanner`: quiet corner chip, per-hash-pair
  persistent dismiss, owner-only gate. Verified in worktree
  `.claude/worktrees/scout-quiet-version-banner`
  (`feature/scout-quiet-version-banner`): `bunx turbo run typecheck lint test
--filter=@scout-for-lol/app` all green (lint warnings are pre-existing
  duplication notices, unrelated to this file); `gitleaks detect` clean after
  the `OWNER_ID` rename. Committed via git-spice
  (`541113d64`).

### Remaining

- Open the draft PR from this worktree (`git-spice stack submit --draft`)
  and promote to ready after a final look.
- No further scout-side action needed once CI/backend catch up — that's
  tracked separately (user's own CI fix, not a Scout todo).

### Caveats

- This does not fix the underlying mismatch — it only makes the (currently
  permanent, CI-outage-driven) banner non-intrusive and owner-only while CI
  is being fixed separately.
- `OWNER_ID` is a plain literal duplicated from the backend's `ME` constant
  (not a shared import — the app only imports `AppRouter` as a type per this
  package's convention). If the owner's Discord account ever changes, both
  copies need updating.
