# TaskNotes Windows constraints

This is the native Windows 11 x64 client over the shared Rust core.

- Keep `TaskNotes.Windows.Host` portable and free of WinUI/Windows Runtime APIs.
- Keep presentation logic portable. App and Presentation never reference
  generated UniFFI code.
- Every synchronous `FfiSyncEngine` call goes through `EngineRunner` and never
  blocks the UI thread.
- Host HTTP preserves core-authored URLs, headers, bodies, and statuses; it may
  add only the configured bearer token.
- Tokens live in Credential Locker. Only the server URL enters local settings.
- Never edit generated C# under `tasknotes-core/bindings/csharp`; regenerate
  through `cargo xtask` and commit every diff.
- Linux checks use `TaskNotes.Windows.Portable.slnx`. Full Windows claims require
  `bun run windows:verify`, packaging, and runtime assertions.
- Keep coverage baselines below the slowest reliable agent result with
  headroom. Test race-only guards directly.
- Every parity claim needs a passed UIA, server, persistence, or Markdown
  assertion ID.
- Do not activate the prepared Buildkite lane until its tracked interactive
  worker requirement is complete.
