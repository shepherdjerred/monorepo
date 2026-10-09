# Facet for Android

First-party code is GPL-3.0-only. Packaging generates `FirstPartyLicense.txt`
from the exact repository [license text](../../LICENSE); third-party
dependencies retain their own declarations and notices.

Release assets contain Rust notices from the two locked Android target graphs and
host notices from the variant's resolved Maven/JAR/AAR artifacts. The host
inventory records artifact and inherited POM hashes, embedded notice text, and
the exact upstream JNA/libffi notices. Artifacts without package license text are
marked in that inventory; canonical text for their declared Apache 2.0 license
does not invent copyright notices. Source-only notice generation is available
with `gradle :app:generateReleaseHostNoticeAssets :app:generateRustNoticeAssets`.

Native Compose presentation over the standalone Rust TaskNotes runtime. Android
10+ (API29), target36, compile37. `red.sjer.facet` is a new source identity;
Google Play registration and signing are owner-managed release prerequisites.

## Host boundary

`bindings` consumes generated UniFFI Kotlin through JNA. `host` provides private
SQLite/vault storage, Keystore credentials, account HTTP, and the serial
WebSocket executor. `app` supplies Compose workflows and lifecycle. Task,
configuration and Sync policy stay in Rust. No TaskNotes server is required.

The Compose app uses Inbox, Today, Upcoming and Browse navigation, grouped core
pages, and native task/capture/filter sheets. Presentation tokens and configured
color interpretation are validated from `tasknotes-fixtures/presentation`.
Unknown workflow values retain their vault labels; unsupported colors keep the
raw value and expose a per-choice diagnostic with native neutral rendering.
Appearance and motion follow Android settings; haptic and sound preferences are
stored on this device.

Completion admission is per vault, note path and occurrence. Different rows can
queue independently while each submitted action retains its original revision
and mutation ID. A failed editor or capture becomes read-only after durable
admission and routes recovery through Saved actions. Saved feedback is consumed
once per ViewModel lifetime, and snackbar Undo retains its owning vault and exact
receipt while rechecking the engine's current head before execution.

Existing duration and time-entry metadata remains untouched in vault notes.

The host validates the complete raw mutation receipt before presenting template
or filename notices alongside Saved. Each presentation belongs to its original
vault, action, request and engine. Expected observation or cleanup I/O retains
the applied outcome and original action with separate maintenance text; corrupt
receipts fail before observation or discard. Queued results cannot close a newer
draft or show warnings after the selected vault changes.

Private replicas use an NDK bridge for atomic exchange and durable displaced-byte
capture. Arbitrary document-provider trees need a separately proven capability
contract; a SAF grant does not establish safe writable support.

Bounded callback migrations retain earlier backup IDs and combine recorded
legacy/current metadata in sorted pages of at most 128 records. Preserved
bytes are copied into private read snapshots with bounded I/O. Durable
acknowledgements belong to the exact profile and engine namespace and precede
unlink; interrupted cleanup replays that disposition. Missing or ambiguous
legacy capture records remain available for explicit review.

An existing document tree can be imported as an independent app-private copy.
The import reads the provider's files and preserves attachments; it does not
grant two-way writes to the original tree.

Background Sync uses the OS WorkManager budget and durable Rust checkpoints.
Foreground takeover fences network effects immediately, then awaits worker
cleanup before another engine can write. Failure reports contain bounded
classification codes without account responses, paths, credentials or note
bytes. OS scheduling is best effort.

Task reminders are explicitly enabled on each device after notification
permission. Rust supplies complete, version-fenced firing plans; the host
retains existing alarms when a plan cannot be read. Android uses inexact alarms
for the nearest 64 reminders in a rolling 30-day window and reports entries
beyond that scheduling budget. Foreground refresh and settled background Sync
reconcile the plan. Notification routes preserve their owning profile; account
changes fence and cancel affected reminders before credential removal.

## Build and verification

Run root setup first. SDK requirements: platform37, build-tools37.0.0,
NDK28.2.13676358 and CMake3.31.6. Java/Gradle come from root mise; no wrapper.

```bash
ANDROID_HOME=/path/to/android/sdk bun run android:build
bun run typecheck
bun run android:test
bun run android:lint
ANDROID_HOME=/path/to/android/sdk bun scripts/verify-page-size.ts
gradle :host:assembleDebugAndroidTest :app:assembleDebugAndroidTest
ANDROID_HOME=/path/to/android/sdk ANDROID_SERIAL=emulator-5554 bun scripts/verify-runtime.ts
```

Repeat runtime acceptance on both4KiB and16KiB images. ELF/ZIP checks cover Rust,
JNI and JNA for both ABIs. JVM/schema tests and emulator tests prove different
layers. Screenshots/transcripts stay under ignored `artifacts/acceptance`.

`android:package` produces an unsigned release AAB for review. The local export
lane rebuilds that bundle through Gradle, validates it using the bundletool graph
resolved by the pinned Android Gradle plugin, and checks the compiled identity,
SDK/backup policy, license assets and every native ELF's 16 KiB alignment.

```bash
bun run android:release --dry-run
bun run android:release --credentials release-signing.local.json
```

The ignored signing bootstrap JSON requires `schemaVersion: 1`, an existing
external `keystorePath`, `storeType` (`JKS` or `PKCS12`), `alias`, the reviewed
upload certificate's lowercase `certificateSHA256`, and configured 1Password
secret references in `storePasswordReference` and `keyPasswordReference`. Keep
the keystore outside the repository with private file permissions. The lane
creates no key or account; passwords reach only the signing child through
`op run` and environment-backed jarsigner password arguments. Tool output is
withheld on credential operations.

Signed exports undergo strict trusted-keystore verification, exact certificate
pinning on every payload entry, and comparison with the untouched unsigned
bundle. Reports beside the local AAB record artifact hashes and the captured
native/app source inventory. Existing exports are preserved; use `--output` to
choose a new path. No artifact is submitted. See Android's
[command-line signing documentation](https://developer.android.com/build/building-cmdline)
and Java's [jarsigner contract](https://docs.oracle.com/en/java/javase/25/docs/specs/man/jarsigner.html).

Store enrollment, owner upload-key provisioning, signing acceptance, submission
and real Obsidian Sync acceptance are separate gates. Native runtime and E2E
acceptance remain separate from this archive/signature verification.
