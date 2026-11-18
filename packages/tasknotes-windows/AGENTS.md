# TaskNotes Windows constraints

This is the native Windows 11 x64 Facet client over the shared HTTP `/api/v1/sync` protocol.

- Keep `TaskNotes.Windows.Host` portable and free of WinUI/Windows Runtime APIs.
- Keep presentation logic portable. `App` and `Presentation` never reference `TaskNotes.Protocol` directly; only `TaskNotes.Windows.Host` depends on `TaskNotes.Core.Bindings` (`FacetProtocol.cs`).
- Production composition uses `FacetSyncStore` (`FacetSqliteCache` over `Microsoft.Data.Sqlite` + `FacetApiClient` posting to `/api/v1/sync`). Local cache reads, optimistic writes, `QueuedCommand` outbox persistence, natural-language quick-add parsing (`QuickCaptureParser`), and RFC 5545 recurrence projection (`RecurrenceCodec`) are pure C# in `TaskNotes.Windows.Host`.
- Every `await` and `await using` inside `src/TaskNotes.Windows.Host/**/*.cs` must call `.ConfigureAwait(false)` (`CA2007`).
- Server bearer tokens live in Windows Credential Locker (`PasswordVault` resource `red.sjer.Facet`, username `api-token`). Nonsecret app preferences and server URL live in `LocalSettings` when packaged, or `%LOCALAPPDATA%\Facet\settings.json` when running unpackaged (`WindowsPackageType=None`).
- Guard WinRT package-identity calls with `PackageIdentity.IsPackaged` so both the MSIX package and the standalone self-contained `TaskNotes.Windows.App.exe` run without `0x80073D54`.
- Never edit generated C# under `packages/facet-protocol/generated/FacetProtocol.cs`; regenerate from the protocol schemas in `packages/facet-protocol`.
- Linux and macOS portable checks use `TaskNotes.Windows.Portable.slnx`. Full Windows claims require `bun run windows:verify`, packaging, and runtime assertions.
- `bun run windows:cross-package` proves the WinUI MSIX (`AppPackages/cross/`) and standalone `win-x64` executable (`AppPackages/win-x64-standalone/TaskNotes.Windows.App.exe`) compile and package inside `windows-cross-compiler-winui`; it is not runtime evidence. Fix toolchain gaps in `packages/windows-cross-compiler`.
- Keep coverage baselines non-decreasing with headroom. Test race-only guards directly.
- Every parity claim needs a passed UIA, standalone store, persistence, or server sync assertion ID.
- Do not activate the prepared CI lane until its tracked interactive worker requirement is complete.
