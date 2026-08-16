# packages/tasknotes-windows

Native Windows 11 x64 TaskNotes client. The durable design is
`packages/docs/plans/2026-08-10_tasknotes-native-windows-app.md`.

- Keep `TaskNotes.Windows.Host` portable and free of WinUI/Windows Runtime APIs.
- Keep presentation logic in the portable `TaskNotes.Windows.Presentation`
  project. App and Presentation must never reference generated UniFFI code.
- Every `FfiSyncEngine` call goes through `EngineRunner`; the generated engine
  is synchronous and must never block the UI thread.
- Host HTTP code preserves core-authored URLs, headers, bodies, and statuses.
  It may add only the configured bearer token.
- Tokens live in Credential Locker. Only the server URL may enter local
  settings.
- Do not edit generated C# under `tasknotes-core/bindings/csharp`. Regenerate
  with `cargo xtask generate-bindings` and commit every binding diff.
- Native DLL/SO output, MSIX packages, certificates, and local signing props
  remain ignored.
- Linux verification uses `TaskNotes.Windows.Portable.slnx`; Windows uses
  `bun run windows:verify` and must compile/package the full solution.
- `coverage-baseline.json` keeps headroom on purpose: the measured percentage
  moves with the host and the thread schedule, so a baseline pinned to the
  observed value turns the ratchet into a coin flip. Raise a baseline only to a
  value the slowest CI agent clears with room to spare, and cover a
  race-only guard with a direct test rather than leaving a stress test to reach
  it by luck.
- Every parity claim needs a runtime assertion ID. Record it only after its
  UIA, server, persistence, or Markdown assertion has passed.
- Do not activate the prepared Windows Buildkite lane until the tracked
  interactive-worker TODO is complete.
