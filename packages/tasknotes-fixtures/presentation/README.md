# Native presentation contracts

This directory is data-only. It supplies native presentation values without
changing the runtime task schema, the immutable oracle fixtures or UniFFI ABI.

`tokens.json` defines semantic color roles, native type roles, spacing, radii,
hit targets, motion and platform layout dimensions. Consumers retain native
semantic colors, system contrast modes and scalable text. A configured task
status or priority remains an open value; its label, color and weight come from
the vault configuration rather than a platform enum.

`color-policy.json` defines CSS RGB/RGBA hexadecimal forms and the exact standard
named-color vocabulary. Eight-digit values are RGBA on every platform. Unsupported
color strings stay in metadata and produce a per-choice diagnostic with native
neutral decoration; they do not remove task access or silently change the value.

`presentation.schema.json` is the strict source contract. Its root validates
tokens, and named definitions `tokens` and `colorPolicy` validate the respective
documents. Platform consumers validate bundled copies before decoding native
types. Required fields, exact values and unexpected fields are all checked.

`feedback.json` defines receipt-owned feedback events, delivery suppression,
native interaction cues and preference migration. `feedback.schema.json` validates
that policy and its `palette` definition validates `audio/palette.json`. Sounds
default on across all platforms; mobile haptics default on. Explicit choices
survive migration. Native audio respects system mute and never takes audio focus.
Logical events are deduplicated by engine session, owning profile and mutation identity; physical
delivery makes at most one attempt and cannot guarantee playback across a crash.

`audio/` contains four first-party procedural 48 kHz mono PCM16 WAVs. The offline
producer is `tasknotes-macos/scripts/generate-feedback-palette.ts`; run it with
`--write` to deliberately regenerate resources, or `--check` to verify exact
bytes and policy schemas. The palette is GPL-3.0-only and retains no third-party
recordings. Historical client WAVs remain unchanged as visual/audio references.

`reference-matrix.json` identifies retained desktop/mobile source owners,
composition rules and acceptance identifiers for each supported state. Account,
Sync and recovery states are standalone-only workflows with retained styling
references. Source references describe their provenance; they do not claim old
iOS screenshots exist. Platform render manifests identify actual native runtime,
appearance, adaptive variant, synthetic state, current source inputs and native
build artifacts. Distinct states are counted by visible rendered differences,
with runtime interaction and gesture acceptance tracked separately.
