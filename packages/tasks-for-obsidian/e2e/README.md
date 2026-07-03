# Maestro e2e harness

End-to-end tests that drive the real iOS app (simulator) against the real
`tasknotes-server` over a real temp vault, with a chaos proxy in between for
offline scenarios. **This suite is the required manual pre-merge gate for app
PRs** — run it locally before merging changes to `packages/tasks-for-obsidian`.

## Prerequisites

- Xcode with iOS simulator runtimes installed
- CocoaPods deps installed (`bun run pod-install`)
- Maestro CLI: `curl -Ls https://get.maestro.mobile.dev | bash`

## Running

```bash
bun run e2e                 # full run: build + install + test
E2E_SKIP_BUILD=1 bun run e2e  # skip `bun run ios` if the app is already installed
```

The orchestrator (`e2e/run.ts`):

1. Creates a temp vault seeded from `e2e/fixtures/seed-vault/`
2. Spawns `tasknotes-server` on `127.0.0.1:18901` over that vault and waits
   for `/api/health`
3. Spawns the chaos proxy (`e2e/chaos-proxy.ts`) on `127.0.0.1:18902 → 18901`
4. Ensures a booted iPhone simulator (boots the newest available if needed)
5. Ensures Metro is running, then `bun run ios --simulator "<name>"`
   (skipped with `E2E_SKIP_BUILD=1`)
6. Runs `maestro test e2e/maestro` with `APP_URL` (the proxy) and `AUTH_TOKEN`
7. Asserts the vault markdown files reflect the flows (created / completed /
   recurring-instance) and prints PASS/FAIL per assertion
8. Tears everything down and removes the temp vault (always)

## How the flows are structured

Every flow starts with `runFlow: 00-setup.yaml`, which launches the app with
cleared state and configures it via the `__DEV__`-only deep link
`tasknotes://e2e-config?apiUrl=…&token=…` (handled by
`src/navigation/E2EConfigHandler.tsx`; a no-op in production builds). Flows
run in filename order and share the same server/vault, so later flows must not
depend on state that earlier flows mutate (the stable sentinel task is
"Water plants", which is never renamed or closed).

| Flow                           | Scenario                                                    |
| ------------------------------ | ----------------------------------------------------------- |
| `00-setup.yaml`                | launch + e2e-config deep link + first sync                  |
| `01-create-task.yaml`          | FAB → Quick Add → task visible                              |
| `02-complete-task.yaml`        | complete the seeded open task (via detail toggle)           |
| `03-recurring-complete.yaml`   | complete today's instance of the recurring task             |
| `04-edit-task.yaml`            | rename "Task with details" via the edit form                |
| `05-offline-queue.yaml`        | chaos-proxy offline → create → optimistic → online → replay |
| `06-offline-crash-replay.yaml` | like 05 but with a kill/relaunch before going back online   |

The chaos proxy is toggled from flows via `runScript` (GraalJS `http.post`)
against `/__chaos/offline` and `/__chaos/online` on the proxy port itself;
control endpoints keep working while "offline".

## Current status (2026-07-03)

The harness is **functional end-to-end**: it builds the app, boots the
simulator, delivers config via the deep link, syncs the seeded vault, and
drives real UI. Verified passing individually and in-suite: `00-setup`,
`01-create-task`, `03-recurring-complete` (and `02`/`04` pass in isolation).

Two known limitations, both expected:

- **Timing flakiness** — mobile e2e is inherently timing-sensitive; the
  first cold sync and the on-screen keyboard occasionally race an assertion.
  When a flow flakes it is almost always at the `00-setup` sync sentinel or a
  post-input button tap. Re-running usually passes.
- **`05-offline-queue` / `06-offline-crash-replay` are P2 acceptance tests.**
  They assert offline-created work survives reconnection and an app restart —
  exactly the behavior the offline-first rework (plan phase **P2**) makes
  robust. On the current pre-P2 app they exercise the buggy path on purpose
  and are expected to stabilize when P2 lands. Treat them as the P2
  acceptance criteria, not a gate on unrelated app changes.

Until P2, the practical pre-merge gate is: `00`–`04` green (re-run flakes).

## Notes

- The app must be a **Debug** build: the e2e-config deep link only works when
  `__DEV__` is true, and Debug builds need Metro (the orchestrator starts it).
- `00-setup` waits for the app's tab bar before firing the deep link: a
  `clearState` relaunch is still booting, and an immediate `openLink` races
  app startup so the JS `Linking` listener misses the `url` event.
- Seed fixtures use fixed dates: "Water plants" is intentionally overdue so it
  always appears on the Today tab; "Seeded open task" is due in the future so
  it lives on the Inbox tab.
- These files are excluded from `bun test` (no `*.test.ts` here) and from the
  app's `tsc` project; they are linted via ESLint's `allowDefaultProject`.
