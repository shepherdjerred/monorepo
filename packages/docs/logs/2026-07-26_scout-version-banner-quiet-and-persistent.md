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
(`ContractMismatchBanner`) plus the backend `GET /api/version` handler.
Follow-up ask from the user: "really could we somehow limit this to just my
user" — end users have no control over a backend/frontend contract mismatch,
so it should never render for anyone but the app owner.

- Replaced the full-width `Card` (pushes page content, two `Button`s) with a
  small `fixed bottom-right` corner chip — out of the page flow entirely.
- Dismiss now persists to `localStorage`
  (`scout:dismissed-contract-mismatch`), keyed by the specific
  `appContractHash:backendContractHash` pair rather than a plain boolean.
  Dismissing silences that exact known mismatch across reloads/sessions, but
  a _new_ mismatch (either side redeploying to a different hash) un-dismisses
  it automatically — so it can't permanently mask a genuinely new skew.
- **Owner detection is server-side, not client-side.** The initial approach
  embedded an `OWNER_ID` literal in the app and gated on
  `trpc.auth.meWeb`; that was superseded during review to avoid a second
  source of truth for the owner account and to keep the diagnostic
  independent of the tRPC contract (the very thing it exists to surface) and
  off the protected identity procedure on the public login route. The
  committed design: `GET /api/version` (public, unauthenticated) now returns
  a `canViewContractMismatch` boolean, computed on the backend from the
  signed session cookie + the existing `ME`/`debug` flag
  (`packages/backend/src/configuration/flags.ts`). The app reads that boolean
  — no `OWNER_ID`, no `auth.meWeb`. `canViewContractMismatch` is optional in
  the app's `VersionResponseSchema` (`z.boolean().default(false)`) so an
  older backend that predates the field still parses.
- **Non-owners never receive the real contract hash.** A legacy SPA bundle
  (pre owner-gating) still open across a redeploy ignores
  `canViewContractMismatch` and would render its banner from `contractHash`
  alone, so client-side gating is not enough. The handler returns the shared
  no-mismatch sentinel `DEV_PLACEHOLDER` (from
  `@scout-for-lol/data/build-identity.ts`, imported by both the app's
  `isContractMismatch` and the backend) as the `contractHash` for non-owner
  sessions; every bundle generation then treats it as "no mismatch" and stays
  silent. Owners get the real hash.

## Session Log — 2026-07-26

### Done

- Root-caused the "Reload does nothing" report to a live main-CI outage (not
  a frontend bug): every build since 6277 has failed/hung due to a buildx
  interactive-privilege-prompt bug from PR #1668, which blocks
  `version-commit-back` from ever advancing beta's backend image pin while
  the site deploy step ships newer frontend bundles independently. Findings
  reported to user; user is fixing CI separately.
- Rewrote `ContractMismatchBanner`: quiet corner chip, per-hash-pair
  persistent dismiss, owner-only gate. The owner gate moved server-side
  during review (see `## Change`): `GET /api/version` returns
  `canViewContractMismatch` from the backend `ME`/`debug` flag and withholds
  the real `contractHash` from non-owners, so no `OWNER_ID` literal or
  `auth.meWeb` call remains in the app. Verified in worktree
  `.claude/worktrees/scout-quiet-version-banner`
  (`feature/scout-quiet-version-banner`): `bunx turbo run typecheck lint test
--filter=@scout-for-lol/app --filter=@scout-for-lol/backend` green.

### Remaining

- Open the draft PR from this worktree (`git-spice stack submit --draft`)
  and promote to ready after a final look.
- No further scout-side action needed once CI/backend catch up — that's
  tracked separately (user's own CI fix, not a Scout todo).

### Caveats

- This does not fix the underlying mismatch — it only makes the (currently
  permanent, CI-outage-driven) banner non-intrusive and owner-only while CI
  is being fixed separately.
- The owner account has a single source of truth: the backend `ME` constant
  (`packages/backend/src/configuration/flags.ts`). The app no longer carries
  an `OWNER_ID` literal — it consumes the backend's `canViewContractMismatch`
  decision over `GET /api/version`.
- Non-owner sessions get `DEV_PLACEHOLDER` as the `/api/version`
  `contractHash`, so the version footer shows `api contract dev` for them —
  intentional (the real hash is an owner-only developer diagnostic).
