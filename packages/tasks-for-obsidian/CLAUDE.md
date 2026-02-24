# Tasks for Obsidian

React Native mobile app (iOS/Android) that syncs with the TaskNotes Obsidian plugin via its HTTP API.

## NOT a workspace member

This package has its own `node_modules` and `bun.lock` — same as `clauderon/mobile`.

## Commands

```bash
cd packages/tasks-for-obsidian
bun install                          # Install deps
bun run typecheck                    # Type check
bunx eslint . --max-warnings=0       # Lint
bun test                             # Tests
bun run ios                          # Run on iOS
bun run android                      # Run on Android
```

## Architecture

- **domain/** — Pure types, Zod schemas, Result<T,E>, errors (no React)
- **data/** — API client (Zod-validated), AsyncStorage cache, sync engine
- **state/** — React contexts (Tasks, Settings, Sync, Pomodoro, TimeTracking)
- **hooks/** — Custom hooks bridging state to UI
- **screens/** — Full-screen views
- **components/** — Reusable UI (TaskRow, pickers, badges)
- **navigation/** — React Navigation (NativeStack + BottomTabs)
- **styles/** — Color themes, typography
- **lib/** — Utility functions (NLP, dates)

## Patterns

- Follows `packages/clauderon/mobile/` patterns: bare React Native, context-based state, class-based API client
- **Zod schemas** validate every API response — no `as T` casts
- **Branded types** for IDs: `TaskId`, `ProjectName`, `ContextName`, `TagName`
- **`Result<T, AppError>`** for expected failures — no try/catch for business logic
- Strict tsconfig matching clauderon/mobile
