# TaskNotes Windows constraints

This is the native Windows 11 x64 client over the shared Rust core.

- Keep `TaskNotes.Windows.Host` portable and free of WinUI/Windows Runtime APIs.
- Keep presentation logic portable. App and Presentation never reference
  generated UniFFI code.
- Every synchronous native engine or Obsidian session call goes through `EngineRunner` and never
  blocks the UI thread.
- Host HTTP and WebSocket adapters execute core-authored account/session effects.
  Domain, filtering, recurrence, protocol, cryptography and conflict policy belong
  to Rust. Validate JSON against the shared fixture schemas at every boundary.
- Account tokens and owner-qualified vault keys live in Credential Locker.
  Profile capabilities and selection are nonsecret app-local metadata. Stop all
  affected sessions before changing the account or removing its credentials.
- Production composition uses `FacetTaskNotesStore`. Direct Sync writes only to
  app-private replicas. External folder capabilities remain read-only until real
  Windows handle safety and power-loss durability have been verified.
- Preserve immutable retry envelopes and binary upload/conflict payloads. Never
  manufacture upload timestamps or substitute service UIDs for content hashes.
- Never edit generated C# under `tasknotes-core/bindings/csharp`; regenerate
  through `cargo xtask` and commit every diff.
- Linux checks use `TaskNotes.Windows.Portable.slnx`. Full Windows claims require
  `bun run windows:verify`, packaging, and runtime assertions.
- `bun run windows:cross-package` and the `tasknotes-windows-cross` CI step
  prove the WinUI app compiles and packages on Linux; they are not runtime
  evidence. Fix toolchain gaps in `packages/windows-cross-compiler`.
- Keep coverage baselines below the slowest reliable agent result with
  headroom. Test race-only guards directly.
- Every parity claim needs a passed UIA, standalone engine, persistence, or Markdown
  assertion ID.
- Do not activate the prepared CI lane until its tracked interactive
  worker requirement is complete.
