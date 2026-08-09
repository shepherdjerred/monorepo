---
id: plan-2026-08-08-tasknotes-native-macos-app
type: plan
status: in-progress
board: true
verification: human
disposition: active
---

# TaskNotes Native macOS App on a Shared Rust Core

Canonical spec. Subagents implementing any phase should read this file first.

## Goal

A genuinely native macOS app (SwiftUI/AppKit, real platform controls) over **one shared core
in Rust**, as the first of two native desktop clients (Windows/WinUI 3 follows). The React
Native iOS app stays as-is for now and adopts the same core in a later phase.

## Why a shared Rust core

With three native targets the core would otherwise be written three times — TypeScript, Swift,
C# — which is how 1Password shipped _"different search results in a different order"_ between
platforms. One Rust core with UniFFI bindings is the shape 1Password, Signal, Proton, Bitwarden,
and matrix-rust-sdk all ship.

Measured in `packages/tasks-for-obsidian`: non-UI code (`domain` + `data` + `lib`) is 3,695 LOC
(**31%**); UI layers are 8,214 LOC (**69%**). At two implementations duplication would have been
cheaper than an FFI; at three it is not.

**Decisions:** all 15 screens at _capability_ parity · hand-rolled recurrence engine · direct
download with Developer ID + notarization + Sparkle · macOS 15 deployment target.

## Two clarifications

**"Parity" means capability, not interaction.** ~700–800 LOC of the RN app is touch scaffolding
to be **deleted**, not translated: `SwipeActions`, `Fab`, `TipPopover`, `SortPicker` (an iOS-only
no-op today), safe-area plumbing, `BulkActionBar`, bottom sheets, pull-to-refresh, haptics. Each
needs a desktop idiom — hover actions and `⌘⌫`, toolbar `+` and `⌘N`, popovers anchored to fields,
`⌘R`, native multi-select `List`.

**macOS 15 costs nothing.** The macOS 26 rich `TextEditor` only matters for WYSIWYG markdown,
which the iOS app doesn't do — it edits plain markdown source and renders it read-only. If WYSIWYG
is wanted later, light it up behind `if #available(macOS 26, *)` on that one field.

## Architecture

```
packages/tasknotes-core/
├── crates/
│   ├── tasknotes-core/       # PURE. #![forbid(unsafe_code)]. Max rigor. Linux-testable.
│   └── tasknotes-core-ffi/   # UniFFI scaffolding ONLY. unsafe_code = "deny" + one #[expect].
├── bindings/                 # COMMITTED generated bindings — the drift guard
├── xtask/                    # build orchestration (modelled on matrix-rust-sdk)
├── package.json / turbo.json # turbo shim → cargo (src-tauri precedent)
├── clippy.toml · deny.toml
packages/tasknotes-fixtures/       # @tasknotes/fixtures — ZERO dependencies, data only
├── schema/scenario.schema.json    # sync scenario format
├── scenarios/*.json               # the 25 sync scenarios
└── recurrence/{corpus.jsonl,manifest.json,corpus.schema.json}
packages/tasknotes-macos/
├── project.yml · Package.swift · .swiftlint.yml
└── Sources/{TaskNotesUniFFI,TaskNotesKit,TaskNotesMac}/
```

**Fixtures are data; producers and consumers live elsewhere.** `@tasknotes/fixtures` must keep
**zero dependencies** — that is exactly what lets the Rust crate consume it without dragging a
TypeScript dependency graph behind it. So the _generators_ and _runners_ stay in
`packages/tasks-for-obsidian/` (they necessarily depend on `tasknotes-types` → `@tasknotes/model`
→ rrule.js), and only their output is shared. This also means the generators correctly die with
the RN app when it migrates — by then their output is frozen and committed, which is the point of
an oracle.

**The two-crate split is right, but not for the reason originally stated.**

⚠️ _Corrected 2026-08-08 during Phase 1, by direct test at uniffi 0.31.2 / rustc 1.97.1._ An
earlier version of this plan claimed `#![forbid(unsafe_code)]` **cannot compile** in a crate
containing UniFFI scaffolding. **That is false — it compiles clean.** `uniffi_macros` does emit
`unsafe extern "C"` items into the consuming crate, but rustc's `unsafe_code` lint skips spans
originating in an _external_ macro, so those items produce no diagnostic.

Consequence: a crate-level `#[expect(unsafe_code, reason = "…")]` on the FFI crate is
**impossible** — it would be unfulfilled, and gate 4 (`unfulfilled_lint_expectations = "deny"`)
rejects it. The FFI crate therefore carries **no** crate-level attribute and simply inherits the
workspace `unsafe_code = "deny"`, which still fails on any hand-written `unsafe`. `deny` rather
than `forbid` is deliberate, so a future toolchain change leaves an `#[expect]` escape hatch.

The split still stands, on its real merits: the pure crate genuinely keeps `forbid(unsafe_code)`,
and isolating the FFI layer is what makes coverage thresholds, `cargo-mutants`, and miri tractable
by running them on a crate with no FFI noise.

**Sans-I/O.** HTTP and storage are traits the shell implements. Keeps `URLSession` on Apple and
sidesteps UniFFI's worst gap: **async has no cancellation support at all**. Design `cancel()`-style
APIs from day one.

### 🔴 `TaskApi` is at the wrong level — architecture defect, found Phase 7b

`sync::host::TaskApi` is **domain-level**: `create_task(&CreateTaskRequest) -> Result<Task>`,
`list_tasks() -> Result<Vec<Task>>`. So the host is responsible not just for HTTP but for the
**entire wire boundary** — URL construction, the four-entry rename table, path-as-id, envelope
unwrapping, and HTTP-status → error mapping.

**This defeats the premise of the whole project.** The justification for a shared core is that with
three native targets, wire logic written three times produces exactly what 1Password shipped:
_"different search results in a different order."_ Under the current trait, TypeScript has that
logic, Swift has now had to transcribe it (~180 LOC, marked TEMPORARY), and C# would need it next.
Three implementations of the one layer the core exists to own.

**It is also a live correctness hazard, not just duplication.** `classify()` branches on exactly
`Error::kind()` and `status()`. Phase 6.5 noted that _"a host's 503 arriving as anything but
`Api { status: 503 }` would silently turn a transient failure into a dead-lettered command."_ So
today, **correct retry behaviour depends on every shell mapping HTTP status codes identically** —
by convention, with nothing mechanical enforcing it. Put differently: the retry classifier's input
is currently partly a _shell policy decision_.

**And it already mangles user data. This is the argument that settles it.** `serde_json` is built
with `preserve_order` and the core keeps unmodelled frontmatter in an `IndexMap`, so vault key
order round-trips exactly. Foundation's `JSONSerialization` **has no ordered dictionary**, so any
task carrying `customProperties` has its keys scrambled inbound _and_ outbound. The server writes
YAML frontmatter from those keys — so **a client that reads a task and later writes it back
reorders the user's frontmatter.** Invisible in the UI, plainly visible in `git diff`, and vaults
are commonly in git. It is **unfixable inside Swift**: Foundation simply has no ordered JSON type.
Only moving the boundary back into the core fixes it.

Second, softer: the Rust `wire.rs` is validated against `@tasknotes/fixtures`; the Swift copy is
validated against examples someone wrote by reading the Rust. **There is no shared oracle over it**
— which is the 1Password failure mode exactly, one layer down.

**The fix: make `TaskApi` a transport.** The host sends bytes and returns bytes; the core owns
everything above that:

```rust
pub trait Transport: Send + Sync {
    fn send(&self, request: HttpRequest) -> Result<HttpResponse>;
}
// HttpRequest  { method, path, query, headers (incl. X-Mutation-Id), body: Option<String> }
// HttpResponse { status: u16, body: String }
```

The wire code this needs **already exists and is tested** in `domain/wire.rs` — `to_wire_task_fields`,
`create_task_body`, `update_task_body`, `unwrap_envelope`, `WireTask`. Nothing new has to be
written; the trait boundary is simply in the wrong place, so the core cannot reach its own wire
layer on the host's behalf. Status→error mapping moves in alongside it, which is where `classify()`
already lives.

**Seven design constraints, each learned from something Phase 7b actually hit:**

1. **The error type must be transport-only** — `TransportError { kind: Timeout | Offline | Tls | Other, message }`. Status→error mapping is core policy, not shell policy.
2. **The core builds the absolute URL.** `CharacterSet.urlPathAllowed` permits `/`, which is wrong for a single path component and cost a test to find. C# would rediscover it.
3. **Body is `Vec<u8>`, never `String`.** `FfiConverterString` strips a leading BOM — one of the very fixes the `=0.31.2` pin exists for — so a response carrying a BOM would be silently altered. Bytes make the question disappear.
4. **Headers are `Vec<HttpHeader>`, not a map.** Order and duplicates are real, `HashMap` is banned in anything crossing, and it makes `X-Idempotent-Replay` — which the server sets and _both_ clients currently ignore — available to the core for free.
5. **Design cancellation in now.** `URLSessionTaskApi` today has _no_ cancel path: quit mid-request and the thread blocks until the 15 s timeout. Bytes-in/bytes-out lets the host own session lifetime, but the core still needs an explicit `cancelAll()`-shaped hook per the day-one rule.
6. **Do not model streaming.** The largest `/v2` payload is a 200-task page; a chunk-callback shape is something UniFFI expresses badly.
7. **The completeness check is a `grep`.** Afterwards the Swift host layer should mention `HttpRequest`/`HttpResponse`/`TransportError` and **no** domain type — no `TaskId`, `CreateTaskRequest`, `TaskStatus`, `InstanceCompletion`. It matches 2 files today.

Auth stays in the shell's constructor rather than a header the core invents blind — the token comes
from the platform keychain, and passing it at engine construction matches "reconfigure ⇒ new engine".

Net effect on the shells: `WireBridge.swift` is **deleted**, `URLSessionTaskApi` shrinks to a bytes
transport, and a future C# shell inherits correct wire handling and correct retry classification for
free. Sequenced after Phase 7b so it deletes Swift code rather than reworking it.

**Pin `uniffi = "=0.31.2"`.** `UNIFFI_CONTRACT_VERSION` is 30 across all 0.31.x; .1/.2 fix an iOS
ASAN crash, a Swift async memory leak, a strict-concurrency warning, and `FfiConverterString`
stripping a leading BOM. ⚠️ `uniffi-bindgen-react-native` pins `=0.31.0` exactly — same contract
version, but verify at the iOS phase.

**Structural rule:** keep SwiftUI out of `TaskNotesKit`. Zero SwiftUI/AppKit imports there means
it compiles and tests on Linux, which is most of the CI story.

## Engineering principles, translated

| Principle                 | Rust                                                                                        | Swift                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| No type assertions        | `as_conversions`, `cast_*` deny                                                             | **`SWIFT_STRICT_MEMORY_SAFETY = YES`** + custom rule banning `unsafeBitCast`/`unsafeDowncast` |
| Strong static typing      | newtypes, `forbid(unsafe_code)`                                                             | `SWIFT_VERSION = 6`, `ExistentialAny`, no IUOs                                                |
| Validate at IO boundaries | parse-don't-validate constructors                                                           | failable `init?` + validating `init(from:)`                                                   |
| Fail loudly               | typed `Error::Invariant` variant                                                            | typed `throws` (baseline in 6.4)                                                              |
| No suppressions           | `allow_attributes`, `allow_attributes_without_reason`, `unfulfilled_lint_expectations` deny | custom rule banning `swiftlint:disable`; `superfluous_disable_command` on                     |
| Let the compiler work     | exhaustive match                                                                            | warnings-as-errors, custom rule banning `default:`                                            |

**`as!` is NOT Swift's analogue of TypeScript's `as`.** TS `as` is a compile-time assertion with
zero runtime check; `as!` is a runtime-checked downcast that traps — a loud crash, not a silent
lie. The real analogues are `unsafeBitCast`, `unsafeDowncast`, `assumingMemoryBound`, and
`@unchecked Sendable`. `as?` stays legal — it _is_ the runtime validation the principles ask for.

**"Fail fast" is different behind an FFI.** A Rust panic is caught by `catch_unwind` but surfaces
as an untyped internal error, can poison a `Mutex`, and leaves the engine in unknown state. So
contract violations become a **typed `Error::Invariant` variant** that is loud — logged, reported,
returned across FFI — never a panic. **Never set `panic = "abort"`**; it defeats `catch_unwind`
and converts every bug into a `SIGABRT`.

**No Zod clone for Swift.** The candidates have 6 and 0 stars. `Codable` + failable `init?` is
idiomatic _and structurally stronger_: Zod's guarantee ends at the parse call, a failable init plus
`let` holds the invariant for the value's lifetime. Never a `@propertyWrapper` — wrappers can't
fail a decode, only substitute a default, which is the silent fallback the principles ban.

### Rust — ten load-bearing gates

1. The two-crate split
2. `unwrap_used`, `expect_used`, `panic`, `indexing_slicing`, `todo`, `unimplemented` at **deny**
3. `clippy.toml` `disallowed-methods` banning `SystemTime::now`, `Instant::now`, `Local::now`,
   `thread_rng` — the only mechanical determinism enforcement that exists.
   ⚠️ **`disallowed-methods` silently ignores paths it cannot resolve.** The `rand::*` bans are
   currently _inert_ because no crate depends on `rand` directly; they activate when it's added.
   The other three were verified to fire. Re-verify any ban when its crate first appears.
4. `allow_attributes` + `allow_attributes_without_reason` + `unfulfilled_lint_expectations` deny —
   makes "no suppressions" a compiler invariant; `#[expect]` self-expires
5. `cargo-deny` with `[bans.build] allow-build-scripts`
6. `clippy::iter_over_hash_type = "deny"`
7. Committed `bindings/` + `git diff --exit-code` — the only guard against UniFFI's silent
   Record-reordering corruption, which no Rust tool catches
8. `proptest` + `proptest-state-machine` for merge/convergence laws
9. `panic = "unwind"` in release
10. Cross-platform determinism hash check

`pedantic` wholesale is fine. **Never** `restriction` or `nursery` wholesale. `chrono` 0.4.45 (not
`jiff`), `IndexMap`/`BTreeMap` never `HashMap` in serialized output, `serde_json` with
`preserve_order`, `rand_chacha::ChaCha8Rng` never `StdRng`, `thiserror` 2.x, `imbl` not `im`.

**Skip as ceremony:** `cargo-vet`, `cargo-audit` (subsumed by `cargo deny`), `cargo-outdated`,
`loom`, miri as a PR gate, `bolero`, and every taste lint. **Every low-value lint you enable makes
the high-value ones easier to ignore**, which undermines the no-suppressions principle.

### Swift — compiler first, linter second

⚠️ **Xcode 27's app template sets `SWIFT_VERSION = 5.0`.** A fresh app is not in Swift 6 mode.

```
SWIFT_VERSION = 6
SWIFT_TREAT_WARNINGS_AS_ERRORS = YES        # + GCC_ equivalent for UniFFI headers
SWIFT_STRICT_CONCURRENCY = complete
SWIFT_APPROACHABLE_CONCURRENCY = YES        # umbrella: 5 upcoming features
SWIFT_STRICT_MEMORY_SAFETY = YES            # the "no type assertions" gate
SWIFT_UPCOMING_FEATURE_EXISTENTIAL_ANY = YES
SWIFT_UPCOMING_FEATURE_MEMBER_IMPORT_VISIBILITY = YES
SWIFT_UPCOMING_FEATURE_INTERNAL_IMPORTS_BY_DEFAULT = YES   # own commit; high churn
SWIFT_DEFAULT_ACTOR_ISOLATION = nonisolated                # override template's MainActor
```

Per target: `nonisolated` for `TaskNotesUniFFI` (required — uniffi-rs#2818 makes `MainActor`
uncompilable) and `TaskNotesKit`; `MainActor` only for `TaskNotesMac`.

⚠️ **Three of these settings blow up on generated code. Measured, not guessed** (spike, 2026-08-08):

| Setting on `TaskNotesUniFFI`                                                               | Result                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.treatAllWarnings(as: .error)` alone                                                      | clean                                                                                                                                                                                 |
| `-strict-concurrency=complete`, `MemberImportVisibility`, `NonisolatedNonsendingByDefault` | clean                                                                                                                                                                                 |
| **`.strictMemorySafety()`**                                                                | 288 warnings → **37 errors**. **Not post-processable** — 116 are "expression uses unsafe constructs" on arbitrary expressions, and the flag is module-wide with no file-level opt-out |
| **`ExistentialAny`**                                                                       | **19 errors**. Post-processable (9 mechanical sites)                                                                                                                                  |
| **`InternalImportsByDefault`**                                                             | **65 errors**. Post-processable — 2-line sed, but **both** `Foundation` _and_ the FFI module must become `public import`                                                              |
| all gates together                                                                         | **119 errors**                                                                                                                                                                        |

### The rule: generated code is exempt, authored code is maximal

**Do not post-process generated code to satisfy lints.** Exempt it instead. `TaskNotesUniFFI` is
machine-generated, never hand-edited, and regenerated on every build — running `sed` over it to
appease `ExistentialAny` would add a brittle transform to maintain across every uniffi upgrade, in
exchange for lint coverage on code no human will read.

So `TaskNotesUniFFI` gets **only** `swiftLanguageMode(.v6)` and `.defaultIsolation(nil)`. Drop
`.strictMemorySafety()`, `ExistentialAny`, `InternalImportsByDefault`, and
`treatAllWarnings(as: .error)` on that target alone. The two verified post-processors from the
spike are recorded in the plan history but **not adopted**.

**This costs nothing in safety, and that is measured, not assumed.** The spike verified
`TaskNotesKit` keeps `.strictMemorySafety()` _and_ `treatAllWarnings(as: .error)` and builds clean
while calling into the FFI module — **unsafety does not leak across the module boundary.** Every
gate still covers 100% of hand-written Swift.

**Generated code is guarded by a different and more appropriate mechanism:** the committed
`bindings/` snapshot plus `git diff --exit-code`. That catches the failure mode that actually
matters there — silent Record reordering, which the spike proved no checksum detects — and which
no lint would ever have caught.

Apply the same rule everywhere it comes up:

| Surface                                                                           | Posture                                                                                                           |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `crates/tasknotes-core/**` (authored Rust)                                        | maximal — `forbid(unsafe_code)`, full lint set                                                                    |
| `crates/tasknotes-core-ffi/**` (thin authored wrapper over generated scaffolding) | full workspace lints; scaffolding spans are external-macro and produce no diagnostics anyway                      |
| `Sources/TaskNotesUniFFI/**` (generated)                                          | **exempt**; guarded by the bindings drift check                                                                   |
| `Sources/TaskNotesKit/**`, `Sources/TaskNotesMac/**` (authored Swift)             | maximal                                                                                                           |
| `.swiftlint.yml`                                                                  | already excludes `Sources/Generated` and `**/*.generated.swift` — keep that list in sync with the SwiftPM targets |

⚠️ One consequence worth knowing rather than fixing: UniFFI error enum cases keep Rust PascalCase
in Swift (`.Invalid(reason:)`, `.NotFound`) while `uniffi::Enum` cases get lowerCamelCase
(`.inProgress`). Since the generated target is lint-exempt this won't fail a build, but it _will_
look inconsistent at call sites in authored code. Phases 3 and 8 should expect it and not try to
"fix" it upstream.

In `Package.swift` (tools-version 6.2): `.treatAllWarnings(as: .error)`, `.strictMemorySafety()`,
`.defaultIsolation()`, `.enableUpcomingFeature()`. **No `unsafeFlags`** — it would make the package
unusable as a versioned dependency, and iOS is meant to consume it later.

`.swiftlint.yml`: today `swiftlint --strict` with no config runs only the 101 default rules —
every principle-encoding rule is opt-in and off. Enable `force_unwrapping`,
`implicitly_unwrapped_optional` (mode `all`), `discouraged_optional_boolean`,
`discouraged_optional_collection`, `fatal_error_message`, `untyped_error_in_catch`,
`unhandled_throwing_task`, `discouraged_assert`, `variable_shadowing`,
`raw_value_for_camel_cased_codable_enum`, plus analyzer rules `unused_import`/`unused_declaration`
(separate CI step, needs a build log, never `--fix`).

Five things need **custom regex rules** (no built-in exists): ban `default:` in switch (highest
leverage — the compiler allows it and it silently absorbs new enum cases), `print`,
`swiftlint:disable` comments, `try?`, and unsafe type escapes. SwiftLint owns semantics only;
**`swift-format` owns all whitespace**. **No `baseline:`** — a suppression file with better branding.

**Honest exclusions:** skip `explicit_type_interface` (fires on `case let` bindings you can't
annotate), `explicit_acl`, `no_magic_numbers`, `strict_fileprivate`, `one_declaration_per_file`,
`sorted_enum_cases`. **Relax force-unwrap in test files** via scoped config — in a test `x!` _is_
the assertion, and `guard let else { return }` can make a broken test silently pass.

## Testing strategy

⚠️ **No GitHub Actions.** _Decided 2026-08-08._ GitHub-hosted `macos-26` runners would be free
here (public repo), but this repo is deliberately Buildkite-only and iOS release builds already go
through **Xcode Cloud**. Adding a third CI system for one test layer is not worth the surface.
macOS work therefore follows the **existing iOS precedent**: Buildkite owns everything that runs on
Linux, Xcode Cloud owns release builds, and anything needing a Mac GUI is a **local-only pre-merge
gate** — exactly how `bun run e2e` (Maestro) already works for iOS per `tasks-for-obsidian/AGENTS.md`.

| Layer               | Where                  | Tooling                                                             | CI                            |
| ------------------- | ---------------------- | ------------------------------------------------------------------- | ----------------------------- |
| Core logic (bulk)   | Rust                   | `cargo nextest`, `proptest`, `insta`, shared JSON scenarios         | Buildkite Linux, every PR     |
| Wire contract       | Rust vs spawned server | temp vault + process spawn                                          | Buildkite Linux, every PR     |
| FFI boundary        | Swift                  | bindings drift · Record round-trip · **exit test** for panic-aborts | Buildkite Linux, every PR     |
| Swift unit          | `TaskNotesKit`         | Swift Testing, `@Test(arguments:)` over the same JSON               | Buildkite Linux, every PR     |
| View-state snapshot | `TaskNotesKit`         | swift-snapshot-testing, **textual** strategies                      | Buildkite Linux, every PR     |
| Image snapshot      | SwiftUI                | `.image` via `NSHostingView`                                        | **local + Xcode Cloud**       |
| E2E + a11y audit    | XCUITest               | 6–10 flows, `performAccessibilityAudit()`                           | **local-only pre-merge gate** |

Consequence to design around: the Linux row is the only _enforced_ gate, so **push as much
correctness as possible below the SwiftUI line**. That is already the architecture's shape — it
just means the `TaskNotesKit`-has-no-SwiftUI-imports rule is load-bearing rather than tidy.

### Swift on Linux: verified working, deliberately not used

_Measured 2026-08-08 in Docker on both arches, against `git archive HEAD`._ The earlier
"⚠️ untested" caveat is resolved, and the answer is **not** the one the fallback assumed:

- **`uniffi-bindgen` produces byte-identical Swift on Linux** — same SHA-256 as the macOS-committed
  copy, on `aarch64` and `x86_64`. So `cargo xtask check-bindings` is a genuine Linux gate, not a
  vacuous one.
- **The generated Swift compiles, links against the Rust `.so`, and runs** under
  swift-corelibs-foundation. The modulemap's `use "Darwin"` lines are inert there, same as on Apple.
- **`TaskNotesKit`: 58 of 59 tests pass on Linux**, including the integration tests spawning a real
  `tasknotes-server` and asserting on vault markdown — with every authored gate on
  (`strictMemorySafety`, warnings-as-errors, `ExistentialAny`, `InternalImportsByDefault`). The
  zero-SwiftUI-imports rule genuinely holds up. `swift-snapshot-testing` also works there.
- The single failure is legitimate and permanent: on Linux the MainActor executor is **not** pinned
  to the OS main thread, so `Thread.isMainThread` is not a proxy for MainActor isolation and the
  "main thread is refused" test cannot hold. `#if !os(Linux)`.

**So nothing is fundamental — and rows 4–5 stay local-only anyway, on cost:**

1. **Permanent compiler skew.** Linux ships 6.3.3; the app builds on 6.4, and Swift Linux trails
   Xcode by months _every_ release. Under warnings-as-errors across ~1,400 lines of authored Swift,
   that is a standing source of "green locally, red in CI" for reasons unrelated to the change.
2. **Two forked manifests and four `#if os(Linux)` regions** — one of which re-introduces exactly
   the `unsafe` pointer spellings the code deliberately designed away, and one of which forces
   `public import Observation`, widening the public surface `InternalImportsByDefault` exists to
   keep narrow.
3. **A third CI image** (~5 GB/arch) needing Swift + Rust + bun together, with its own promotion
   lane and digest pin, for one test layer.

**The Linux gate therefore contains** — all already passing — Rust `cargo test`/clippy/fmt,
`check-bindings`, `swiftlint --strict`, and `ci/no-suppressions.sh` including the no-UI-imports
check. That is the plan's own stated fallback, reached deliberately rather than by defeat.

**The real gap this exposed is different and cheaper:** `bun run mac:verify` was a _local convention
with nothing enforcing that it ran_. Closed by a `lefthook` pre-commit job gated on staged `.swift`
files. Revisit the Linux lane only if a `ci-swift` image becomes justified for another reason, or if
Swift Linux ever ships in lockstep with Xcode — the cost is now concrete (58/59, one `#if`, one
image, ~60 lines of `#if`) rather than speculative.

⚠️ **Xcode Cloud caveat:** there are reports of macOS app _test_ actions specifically misbehaving
there (iOS test actions are fine). Treat Xcode Cloud as the **release/notarization** path first and
prove the test path before relying on it. If it doesn't work, XCUITest stays local-only, which is
an acceptable landing spot and matches how iOS e2e already operates.

**E2E ceiling, honestly:** Maestro does **not** support macOS and nothing equivalent exists.
Appium's Mac2Driver is XCUITest underneath — a worse trade. So 6–10 XCUITest flows, one per
irreplaceable journey; everything else goes into the Rust JSON scenario runner.

Two upsides: macOS UI tests run on the same filesystem as the app, so "drive UI → assert on the
vault's markdown bytes" is a plain synchronous read — _tighter_ than the iOS Maestro setup. And
`performAccessibilityAudit()` (macOS 14+) is one line per flow for continuous a11y coverage.

### macOS E2E — local-only, and the permission story is fine (spike, 2026-08-08)

`automationmodetool` is **not** the undocumented folklore an earlier draft claimed. A man page ships
in every macOS SDK (`/usr/share/man/man1/automationmodetool.1`) and explicitly names CI as the use
case; the Apple Forums answer came from an **Apple DTS engineer**; the binary is Apple-signed and
links `AutomationMode.framework`, a subsystem separate from TCC, so it **works with SIP enabled**.

Since E2E is now a **local-only pre-merge gate**, this is a one-time developer-machine setup rather
than a CI concern. Run it once:

```bash
sudo automationmodetool enable-automationmode-without-authentication
```

⚠️ It issues its own interactive TTY password prompt — fine interactively, which is the only place
it now runs. Add a **preflight check** to `bun run e2e` so a machine that hasn't been set up fails
instantly with a clear message instead of hanging:

```bash
status="$(/usr/bin/automationmodetool)"
[[ "$status" == *"DOES NOT REQUIRE"* ]] || { echo "run: sudo automationmodetool enable-automationmode-without-authentication" >&2; exit 1; }
```

Keep XCUITest inside our own app's windows — Finder, system dialogs, and screen recording are where
real breakage lives. Avoid Appium Mac2Driver: it _does_ need TCC Accessibility.

_(Retained for the record: GitHub's `actions/runner-images` runs this at image-build time and
hard-fails the image unless it reports `DOES NOT REQUIRE`, asserted after two reboots. So if the
no-GHA decision is ever revisited, hosted runners are a proven option.)_

Don't mock the Rust core — it's a linked static lib, fast and real. Mocking asserts Swift calls
Rust in a particular order, which is testing your own wiring. Wire-contract tests live in **Rust**,
not Swift, so they run free on Linux. Coverage: `cargo llvm-cov` (90% floor, 95% patch); for Swift
every ratchet tool is dead — write a ~40-line script against a committed baseline.

## Phases

| #   | Phase                                                                                               | Depends on |
| --- | --------------------------------------------------------------------------------------------------- | ---------- |
| 0   | TypeScript pre-work — tagged errors, JSON scenario fixtures, recurrence corpus, dead-schema removal | —          |
| 1   | Scaffold both crates with full lint posture                                                         | —          |
| 2   | Recurrence engine (hand-rolled)                                                                     | 0c, 1      |
| 3   | Domain layer                                                                                        | 1          |
| 4   | Sync stack                                                                                          | 0b, 3      |
| 5   | Pure lib logic (nlp, dates, calendar, elapsed)                                                      | 1          |
| 6   | FFI layer + build pipeline (xtask)                                                                  | 3          |
| 7   | macOS app shell                                                                                     | 6          |
| 8   | Vertical slice: Today end-to-end — **quality gate**                                                 | 7          |
| 9   | Remaining 14 screens                                                                                | 8          |

### Phase 0 — TypeScript pre-work

- **0a** Refactor `classify()` in `src/data/sync/commands.ts` off `error.name` string matching onto
  a tagged error kind. Errors must serialize into fixtures; also just better TS.
- **0b** Extract the 13 portable scenarios from `offline-scenarios.test.ts` plus the 12
  `harness.test.ts` meta-tests into language-neutral JSON: `{setup, actions[], assertions[]}` with
  tagged unions. Needs `snapshot(as)` and `relaunch(from)` verbs — crash tests reuse a
  _deliberately stale_ snapshot. One scenario asserts promise reference identity; keep it TS-only.
  Make the existing suite run from the fixtures, no behavior change.
- **0c** Recurrence differential corpus: harvest every distinct `recurrence` string from real
  vaults plus a generated `FREQ × INTERVAL × BYDAY × BYMONTHDAY × BYSETPOS × COUNT/UNTIL` grid, run
  `@tasknotes/model` over ±5 years, snapshot to JSON.
- **0d** Delete the dead half of `domain/schemas.ts` — `TaskListSchema`, `QueryResponseSchema`,
  `DeleteResponseSchema`, `CalendarEventsSchema`, `TimeEntrySchema` are superseded by `wire.ts`,
  and `DeleteResponseSchema` there (`{success}`) contradicts the live contract (`{message}`).

### Phase 2 — Recurrence engine

~600 LOC of naive-date arithmetic behind a `trait RecurrenceEngine`, validated against the 0c
corpus with `insta`. The parity surface is timezone-free: `@tasknotes/model` never sets `tzid`,
strips `DTSTART` for a `Date.UTC` midnight, formats with UTC getters. Replicate exactly: rrule.js's
`between` is **inclusive on both ends**, and the model catches parse failures and returns `true` —
**fail open, or tasks vanish**.

### Phase 3 — Domain layer

Newtypes; serde + validating constructors; `wire.ts`'s 4-entry rename table (`recurrence_anchor`,
`complete_instances`, `skipped_instances`, `customProperties→extraFields`); task-ID-is-the-vault-path;
closed 6-variant status enum (`wire.ts` deliberately wants unknown statuses to fail loudly).
`extraFields` crosses FFI as a JSON `String` via `uniffi::custom_type!` — UniFFI has no `Any` type.
⚠️ **UniFFI `Record` fields are positional in the FFI buffer** — reordering is an ABI break.

### Phase 4 — Sync stack

`commands.ts` (the algebra), `CommandQueue` (squash-on-enqueue; `remapTaskId` rewrites the
dead-letter list too), `TaskStore` (`rebase(base, pending)` never persisted; three-part temp-ID
aliasing), `SyncEngine` (single-flight drain, backoff `[1000, 2000, 4000, 8000, 16000, 32000,
60000]`, `not_found` on delete = success), migrations (v0→v2). Reimplement `FakeServer` in Rust
(~200 LOC — a spec, not a mock: it mirrors the server's `X-Mutation-Id` dedup).

### Phase 6 — FFI layer + build pipeline

An **xtask modelled on `matrix-rust-sdk/xtask/src/swift.rs`** — not `cargo-swift`, which has four
open issues on exactly this path. `cargo build` both Apple arches → `lipo` **per platform** →
`uniffi-bindgen-swift` → headers namespaced into `headers/<Module>/` → `xcodebuild
-create-xcframework` → `dsymutil`. **Static lib, not dynamic** — never a nested signed item, so the
notarization failure class doesn't apply. SwiftPM binaryTarget (local `path:` for dev, URL+checksum
for release, product `type: .dynamic`); **never** cargo in an Xcode build phase.

### ✅ Verified by spike, 2026-08-08 — this section was substantially wrong

A minimal end-to-end repro was built at uniffi 0.31.2 / Swift 6.4 / Xcode 27. Results:

**Two of the three feared codegen bugs do NOT reproduce.** #2917 (modulemap `use "Darwin"`) — the
`use` lines are **inert**, only enforced under `-fmodules-decluse`, which nothing on the
Xcode/SwiftPM path passes; builds clean including against the iOS Simulator 27 SDK. #2803
(`Data.bytes` collision) — clean on Swift 6.4 even with Record fields literally named `bytes`,
`data`, `span`; appears to be a 6.2-era compiler bug since fixed. **Post-processing needed for the
three named issues: zero.**

**#2818 DOES reproduce, and we will definitely hit it.** It only fires when a callback interface
has a **throwing** method — which is exactly the sans-I/O shape (HTTP and storage as traits). The
prescribed `.defaultIsolation(nil)` on the bindings target is correct and sufficient. ⚠️ The sed
posted in the upstream issue is **broken** on 0.31.2 (it prefixes `typealias`, which is illegal);
only needed if bindings are ever compiled inside a MainActor module.

**Two traps that produce 139 `cannot find type 'RustBuffer' in scope` errors:**

1. **`--module-name` defaults to the library basename**, but the generated Swift imports
   `<namespace>FFI`. The command as originally written here was silently broken. **Mandatory:**
   `--module-name <ns>FFI --modulemap-filename module.modulemap`.
2. **`--xcframework` contradicts `-library`.** `--xcframework` prepends the `framework` keyword,
   valid only inside a real `.framework` bundle — but we deliberately ship a static lib via
   `-library` + `-headers`, which produces a plain `Headers/` slice. clang then _silently_ declines
   to build the module (`-fsyntax-only` exits 0), `canImport` goes false, the import compiles out.
   **Drop `--xcframework`.**

**`uniffi-bindgen-swift` is not a shipped binary** — add a `[[bin]]` calling
`uniffi::uniffi_bindgen_swift()` behind a `cli` feature (`bindgen` + `clap` + `camino`).

**Gate 7 validated exactly as claimed.** Swapping two same-typed `Vec<u8>` Record fields left all
16 API checksums _identical_ and the C header _identical_ — only the generated Swift changed.
UniFFI's runtime `uniffiCheckApiChecksums()` does **not** detect Record reordering. The committed
`bindings/` + `git diff --exit-code` really is the only mechanical guard against this class of
silent data corruption.

**Untested:** whether the generated Swift compiles under swift-corelibs-foundation on Linux (no
Linux Swift toolchain available locally). The plan puts Swift unit and snapshot tests on Buildkite
Linux; that claim remains unverified. Verify before relying on it.

### Phase 7 — macOS app shell

XcodeGen. `NavigationSplitView` (RN tabs → sidebar). `Settings` scene at `⌘,`. Register
`tasknotes://`. `@Observable` store — **plain Observation, not TCA**: the state machine lives in
Rust, so a reducer layer would mostly forward to UniFFI calls at full cost.

### ✅ Verified by building and launching it (Phase 7a, 2026-08-08)

Bundle id **`red.sjer.tasknotes.mac`**, product `TaskNotes.app`, sandboxed from commit one
(`app-sandbox` + `files.user-selected.read-write` + `network.client`). Vault access must therefore
go through a system open panel and security-scoped bookmarks — there is deliberately no broad
filesystem entitlement.

Five corrections to the settings above, all found by compiling rather than reasoning:

1. **`SWIFT_APPROACHABLE_CONCURRENCY` cannot be transcribed member-by-member into SwiftPM.** Three
   of its members (`InferSendableFromCaptures`, `GlobalActorIsolatedTypesUsability`,
   `DisableOutwardActorInference`) are already on in Swift 6 mode and emit _"upcoming feature
   already enabled as of the Swift 6 language mode"_ — a **hard failure** under
   `treatAllWarnings(as: .error)`. Only `NonisolatedNonsendingByDefault` and
   `InferIsolatedConformances` belong in `Package.swift`. The Xcode umbrella setting handles this
   correctly, so `project.yml` uses it verbatim.
2. **`unused_import` is unusable here** — it cannot see through `@_exported import`, so every file
   reaching the core through the shim is reported, and deleting the import fails the build. Dropped;
   `unused_declaration` stays and is clean.
3. **`dsymutil` output lands in two places, not one.** Because the bindings product is
   `type: .dynamic`, the Rust archive links into `TaskNotesCore.framework`, **not** the app
   executable: `TaskNotes.app.dSYM` contains **0** `tasknotes_core` references while
   `TaskNotesCore.framework.dSYM` contains **204,506**. ⚠️ **Release and notarization must ship
   both** or Rust frames will not symbolicate in crash reports.
4. Two SwiftLint _default_ rules fight `swift-format` and are disabled with evidence attached:
   `trailing_comma` and `closure_parameter_position`.
5. A path dependency's `package:` identity is the **directory name**, not the manifest `name:`.

**Launching it found a bug that compiling could not:** `tasknotes://browse` opened a _second_
window instead of retargeting the existing one. Fixed with `.handlesExternalEvents(matching:)`.

⚠️ **Fresh-clone prerequisite:** the XCFramework is a gitignored build artifact, so the Swift
package will not link until `cd packages/tasknotes-core && cargo xtask build-xcframework` has run.
`brew install xcodegen swiftlint` is also required.

**Formatting the shell must supply** (deliberately left out of the core, because they are locale-
bound): `formatDate`, `formatDayHeading`, and the date-fallback branch of `formatRelativeDate`.
Note the last one is _partly_ pure — its "Today"/"Tomorrow"/"Yesterday"/"In Nd"/"Nd ago" branches
could move into the core as a `RelativeDate` enum if the Mac and iOS shells both want them; Phase 5
deliberately did not add unrequested API. Also shell-owned: `DateGroup::Later`'s heading, and
localizing `CalendarMonth::title()` / `WEEKDAYS`, which are hard-coded English because the
TypeScript hard-codes `en-US`.

Dependencies, deliberately short: **Sparkle** (pin ≥ 2.9.5 — security fixes), **KeyboardShortcuts**,
**XcodeGen**, **Swift Testing**, **swift-markdown** (parser + our renderer),
**swift-snapshot-testing**, **swift-subprocess 1.0** (pin exactly; every online example is pre-1.0).
Use the platform for `SMAppService`, Security framework, `Settings {}`, `MenuBarExtra`. Avoid
MarkdownUI (maintenance mode), KeychainAccess (no release since 2021), LaunchAtLogin (archived).

### Phase 9 — Remaining screens

Inbox/Upcoming are parameterizations of Today (the three list screens are near-identical triplets —
collapse to one view). TaskDetail as an inspector. Search as `⌘F`. QuickAdd as a floating `NSPanel`
on the global hotkey. Kanban gains real drag-and-drop. Fix on the way in: `TaskList`'s
`onTaskEdit`/`onTaskSetPriority` are never passed today, so `TaskRow`'s Edit and Priority menu items
are dead code — right-click `.contextMenu` finally exposes them.

## Definition of done for the UI

Full standard menu bar in standard order · `⌘,` Settings · **disabled, never hidden** items ·
inactive windows look inactive · de-emphasized selection on focus loss · window state restoration ·
`NSTextView`-backed fields so ⌃A/⌃E/⌃K/⌃Y, system spellcheck and Services work · momentum and
rubber-band scrolling · Page Up/Down and Home/End · system open/save panels · no custom window
chrome · semantic colors following system appearance, **no in-app appearance toggle** · VoiceOver
via AppKit accessibility · **namespaced `accessibilityIdentifier` on every interactive element**,
defined in a module shared with the UI test target so a rename is a compile error · Developer ID
signing + notarization · Sparkle updates.

⚠️ `.accessibilityIdentifier()` on an `HStack` pushes the identifier onto child text elements,
leaving the container unidentified. Use `.accessibilityElement(children: .combine)` first. Bites
hardest on list rows.

## Verification

Core parity (`cargo test` and `bun test` run the same JSON fixtures — the anti-drift mechanism) ·
recurrence parity against the corpus · wire contract in Rust against a spawned server · the per-PR
Linux gate · nightly `macos-26` for image snapshots, XCUITest, a11y audits · the RN app stays green
throughout (Phase 0 touches its sync tests) · `bun run verify` stays green.

## Deferred

**Windows is explicitly out of scope for this plan** _(decided 2026-08-08)_. The focus is macOS.
It may be added later, likely WinUI 3 or something else genuinely native — so the standing
constraint is: **do not make decisions that would make adding Windows hard.** Concretely, that means

- keep the core's exported surface **language-neutral** — no Swift-shaped API leaking into Rust,
  nothing that only makes sense to one binding generator;
- keep `uniffi-bindgen-cs` viable — it is **git-install-only** (not on crates.io) and lags upstream,
  so stay on a uniffi version it targets rather than chasing releases;
- keep the shared JSON fixtures as the contract, so a third implementation validates against the
  same oracle rather than against Swift;
- remember **UniFFI `Record` field order is the ABI** — reordering to suit Swift would silently
  break a future C# binding, and the committed `bindings/` diff is the only thing that would catch it.

None of this costs anything today; it just rules out convenience shortcuts that would be expensive
to undo.

Also deferred: iOS adoption of the Rust core via `uniffi-bindgen-react-native` (green against
RN 0.86.2, but its CLI is slated for rename/deprecation). Worth evaluating then: emitting TypeScript
types from Rust via `ts-rs`/`schemars` would delete the hand-maintained `tasknotes-types` mirror and
its drift guard.

Also parked: **collation.** `compare_titles` approximates `localeCompare` — identical on ASCII,
divergent on accents and punctuation. Options when it matters are an ICU4X collator (real binary
weight on a mobile core) or moving sort into the shell, where each platform's native collation is
_more_ correct than either implementation. Not user-visible until iOS shares the core.

## Remaining

Phases 0–6 are complete and verified: 325 Rust tests, 328 TypeScript tests, zero suppressions,
338/338 recurrence corpus, 25/25 sync scenarios, and the generated Swift compiles, links and runs.

- [ ] **Phase 7** — macOS app shell: XcodeGen project, `NavigationSplitView`, Settings scene,
      `tasknotes://` URL type, `@Observable` store over the core. Bundle id prefix `red.sjer`.
- [ ] **Phase 8** — Today screen end to end against a real server. **Quality gate: do not proceed
      to Phase 9 until it feels right.**
- [ ] **Phase 9** — the remaining 14 screens.
- [ ] **🔴 Phase 4.5 — make `TaskApi` a transport.** See the architecture section above. This is
      the highest-priority remaining item: it is the difference between the shared core actually
      owning the wire boundary and every shell reimplementing it. Sequenced right after Phase 7b so
      it **deletes** `WireBridge.swift` rather than reworking it. Touches `sync/host.rs`, the client,
      and the FFI exports together, then regenerates bindings.
- [ ] **Converge the Rust core on persisted id counters.** Both production bugs are now fixed in
      TypeScript. For the collision bug the TS fix chose _persisting the counters_ and kept Rust's
      mint-and-check loop only as a backstop — and the reasoning is sound enough that Rust should
      follow: the durable-set check can only see ids the client **still holds**, but an id already
      acked and dequeued is gone locally while still live in the server's idempotency store. A
      monotonic persisted counter covers that case; the check cannot. `tasknotes-core`'s
      check-and-retry is correct but strictly weaker. The shared scenario passes under either, so
      this is hardening rather than a parity break.
- [ ] Add `cargo-deny` to `.mise.toml` so it can join the `lint` script; it passes locally but
      cannot run in CI until the toolchain pins it.
- [ ] Add `tasknotes-core` and `tasknotes-fixtures` to the root `AGENTS.md` Structure list and
      Package Notes.
- [x] ~~Verify the generated Swift compiles under swift-corelibs-foundation on Linux.~~ **Done
      2026-08-08 — it works, and we are still not doing it.** See "Swift on Linux" below.
- [ ] Unrelated pre-existing gap spotted during Phase 1: `src-tauri`'s `clippy` turbo task is not
      referenced by `bun run verify` or `.buildkite/pipeline.yml`, so src-tauri clippy has never
      run in CI. ⚠️ **Not a one-line fix** — investigated 2026-08-08: running it today fails before
      reaching any lint, because Tauri's `frontendDist` points at `../dist`, which does not exist
      until the frontend builds. Wiring `clippy` into `verify` therefore needs a turbo `dependsOn`
      on the frontend build (and will lengthen the graph), not just an entry in the task list.
      Belongs to whoever owns `scout-for-lol`.
      _(Note `tasknotes-core` is unaffected — its clippy runs inside its `lint` script, which
      `verify` does invoke.)_

## Comment Log

- 2026-08-08: Plan created after a researched architecture review
  (`~/.claude-extra/research/native-macos-windows-code-sharing.md`) plus library and
  quality-tooling surveys. Supersedes an earlier draft of this file that recorded a
  "duplicate the core, don't build an FFI" conclusion — that reasoning was correct for two
  implementations and does not hold at three.
