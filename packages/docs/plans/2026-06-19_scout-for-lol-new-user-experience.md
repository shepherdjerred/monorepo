# Scout for LoL — Guided New-User Experience (Web App)

## Status

Complete — implemented on `feature/scout-nue`, pending PR + visual verification.

## Context

Scout's web dashboard (`packages/scout-for-lol/packages/app`, a React/Vite/React-Router/tRPC SPA) had **no onboarding** — the first thing a brand-new signed-in user saw was GuildPicker's bare "No manageable guilds" card (no invite button), and past that, a bare subscriptions tab. This adds a **light, guided first-run flow for guild admins**: install Scout → understand player/account/subscription (with a diagram) → subscribe to yourself → optionally add more → "you're done" → optionally create a report **or** competition (difference explained), inline.

**Scope: web app only — no backend, schema, or tRPC changes.** Every action already had a procedure (`subscription.add`, `competition.create`, `report.create`, `guild.listChannels`, `guild.listManageable`, `auth.meWeb`); CSRF is handled centrally. First-run is detected via a **per-user** localStorage flag keyed by Discord id — no migration.

## Decisions (confirmed with user)

- Surface: web app. Audience: guild admins.
- Trigger: **Both, once per USER** — auto-redirect into the wizard on first sign-in (keyed by Discord id), then a dismissible "Get started" banner + persistent "Setup guide" link.
- Report/competition step: **inline** in the wizard (prefilled starter the user mostly confirms).
- Concepts step uses a small **visual diagram**.

## What shipped

Top-level route `/welcome` → `OnboardingWizard`. Step state is a discriminated union driven by `useReducer` + ts-pattern `match` (no XState, no `as`). Flow: `install → pick-guild → concepts → subscribe-self → subscribe-more → done`; from `done`, Finish exits or "Set up more" → `choose-extra` → `build-report` | `build-competition`.

### New files (`packages/scout-for-lol/packages/app/src/`)

- `lib/onboarding-steps.ts` — `Step`/`OnboardingState` union, `onboardingReducer`, `progressStep`/`progressLabel`. Pure + unit-tested (`onboarding-steps.test.ts`, 10 cases).
- `lib/onboarding-storage.ts` — per-user `seen`/`complete` localStorage helpers.
- `lib/discord-invite.ts` — `DISCORD_INVITE_URL` (prod client id `1182800769188110366`, overridable via `VITE_DISCORD_CLIENT_ID`, read through a Zod schema — no ambient `.d.ts`).
- `lib/use-add-subscription.ts` + `components/subscription-fields.tsx` — extracted from `add-subscription-dialog.tsx` so the dialog and wizard share the form + the 7-`kind` result mapping.
- `components/report-form-fields.tsx` — extracted from `report-form.tsx` (`ReportFormFields`, `EMPTY_REPORT_STATE`, `EXAMPLE_QUERY`, `buildReportPayload`).
- `lib/competition-form-state.ts` — lifted `buildCriteria`/`buildDates`/`validateForm` from `competition-form.tsx`.
- `routes/onboarding-wizard.tsx` — the wizard orchestrator.
- `components/onboarding/` — `onboarding-shell`, `-concept-diagram`, `-no-channels`, `-install-step`, `-pick-guild-step`, `-concepts-step`, `-subscribe-step` (self/more), `-done-step`, `-extras-choice-step`, `-report-step`, `-competition-step`.

### Edited files

- `app.tsx` — `/welcome` route.
- `routes/guild-picker.tsx` — per-user auto-redirect + "Get started" banner + invite button on the empty-state + "Setup guide" link.
- `routes/guild-workspace.tsx` / `routes/guild-subscriptions.tsx` — "Setup guide" links.
- `routes/report-form.tsx` / `routes/competition-form.tsx` / `components/add-subscription-dialog.tsx` — now consume the extracted shared pieces (behaviour unchanged).

## Verification

- `bunx tsc --noEmit` ✓, `bunx eslint src` ✓, `bun test` ✓ (10/10), `bun run build` (vite) ✓.
- Manual e2e: `op signin`; `bun run --filter='./packages/scout-for-lol' dev:web` (backend :3000 beta bot, Vite :5180); set `VITE_DISCORD_CLIENT_ID=1311755320745394317` so the install CTA targets the beta bot. After sign-in, confirm the first-visit redirect to `/welcome`; clear `scout_onboarding_seen_<discordId>` / `_complete_<discordId>` in DevTools to re-test.

## Session Log — 2026-06-19

### Done

- Implemented the full wizard + shared-form extractions on `feature/scout-nue` (see file list above).
- Green: typecheck, eslint, `bun test` (10/10 reducer cases), vite build.

### Remaining

- Open PR; capture per-step screenshots + a short GIF via the `dev:web` stack and attach with `toolkit pr asset`.
- Manual e2e against the beta bot in a test guild (needs `op signin`).

### Caveats

- Onboarding completion is tracked **per browser** (localStorage), not server-side — a returning admin on a new device with zero subscriptions will be auto-redirected once. Intentional (keeps it light, no schema migration).
- The build-competition step reuses `CompetitionFormFields`, whose footer "Cancel" links to the competitions list (leaves the wizard without marking complete); the step also offers "← Back" and the shell "Skip setup".
