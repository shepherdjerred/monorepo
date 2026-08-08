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
E2E_SKIP_BUILD=1 bun run e2e  # reuse the existing xcodebuild product
E2E_SKIP_BUILD=1 E2E_FLOW=03-recurring-complete.yaml bun run e2e
                            # focused UI flow; skips suite-wide vault assertions
```

The orchestrator (`e2e/run.ts`):

1. Creates a temp vault seeded from `e2e/fixtures/seed-vault/`
2. Spawns `tasknotes-server` on `127.0.0.1:18901` over that vault and waits
   for `/api/health`
3. Spawns the chaos proxy (`e2e/chaos-proxy.ts`) on `127.0.0.1:18902 → 18901`
4. Ensures a booted iPhone simulator (boots the newest available if needed)
5. Starts Metro, builds the Debug app with `xcodebuild`, installs one clean app
   data container, and waits until Metro can serve the JS bundle
   (`xcodebuild` is skipped with `E2E_SKIP_BUILD=1`)
6. Runs each configured Maestro flow in its own process with `APP_URL` (the
   proxy) and `AUTH_TOKEN`, terminating and relaunching the app between flows
   while preserving app data and the shared vault
7. Asserts selected durable mutations from create, complete, recurring, and
   swipe scenarios in the vault Markdown and prints PASS/FAIL per assertion
8. Tears down child processes; removes the temp vault after a pass and preserves
   it with a printed path after a failure for post-mortem inspection

## How the flows are structured

Every scenario flow starts with `runFlow: 00-setup.yaml`, which configures the
already-running app via the `__DEV__`-only deep link
`tasknotes://e2e-config?apiUrl=…&token=…&nonce=…` (handled by
`src/navigation/E2EConfigHandler.tsx`; a no-op in production builds). The nonce
is a transaction boundary: a flow proceeds only after its exact settings write,
refresh, and Today navigation complete. Flows run in configured order and share
the same app data and server vault, so later scenarios intentionally observe
earlier mutations. "Water plants" remains the stable sync sentinel.

| Flow                                  | Scenario                                                    |
| ------------------------------------- | ----------------------------------------------------------- |
| `00-setup.yaml`                       | launch + e2e-config deep link + first sync                  |
| `01-create-task.yaml`                 | Quick Add → task visible                                    |
| `02-complete-task.yaml`               | complete the seeded open task from its row checkbox         |
| `03-recurring-complete.yaml`          | complete an occurrence and advance the recurring task       |
| `04-edit-task.yaml`                   | rename "Task with details" in the direct editor             |
| `05-offline-queue.yaml`               | chaos-proxy offline → create → optimistic → online → replay |
| `06-offline-crash-replay.yaml`        | like 05 but with a kill/relaunch before going back online   |
| `07-swipe-actions.yaml`               | right-swipe completion + left-swipe deletion                |
| `08-contextual-quick-capture.yaml`    | Today seed + Save & Add Another capture                     |
| `09-saved-view-lifecycle.yaml`        | create + rename + delete a device-local saved view          |
| `10-completed-search-uncomplete.yaml` | search Completed + return a task to Today                   |

The chaos proxy is toggled from flows via `runScript` (GraalJS `http.post`)
against `/__chaos/offline` and `/__chaos/online` on the proxy port itself;
control endpoints keep working while "offline".

## Current status

The harness is **functional end-to-end**. All 11 ordered flows and the final
Markdown vault assertions pass on Xcode 27, the iOS 27 simulator, and Maestro
2.8.0. The suite covers one clean install, per-flow process restarts, a true
kill/relaunch, offline replay, gestures, contextual capture, saved views, and
completed-task recovery.

## Notes

- The app must be a **Debug** build: the e2e-config deep link only works when
  `__DEV__` is true, and Debug builds need Metro (the orchestrator starts it).
- `00-setup` waits for the root header before firing the deep link: an immediate
  `openLink` can race app startup so the JS `Linking` listener misses the `url`
  event.
- Seed fixtures use fixed dates: "Water plants" is intentionally overdue so it
  always appears on the Today tab; "Seeded open task" is due in the future so
  it lives on the Inbox tab.
- These files are excluded from `bun test` (no `*.test.ts` here) and from the
  app's `tsc` project; they are linted via ESLint's `allowDefaultProject`.
