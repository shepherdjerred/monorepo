# Browser and native research controls

These authored controls preserve the browser, measurement and native-material
research that accompanied the retained effects runtime. They are developer tools
for exact local fixtures, not a standalone asset package or a general CI suite.
The [master fidelity map](../../AV-FIDELITY-MAP.md) defines the remaining gates;
the [spike README](../../README.md) owns preparation prerequisites and runtime
commands.

## Source and evidence identity

`source-provenance.json` records each helper's original local path and SHA-256.
The original cache copies remain unchanged. Source-root, relative import and
repository-depth adapters make the promoted tools refer to this research tree.

An original report still identifies the bytes and inputs used by that historical
run. The relocated or formatted helper has a new source identity: copying its
algorithm does not reapprove a native result, make historical missing inputs
available, or establish current browser fidelity. New executions must capture
their own source/input identities and keep their claims within the measured
scope. The source provenance manifest contains no native assets or approval
overrides.

Run commands from the **monorepo root**. Static prepared resources, exact native
images, archived reports, and browser response bodies remain under ignored
`.cache/replay-spike/` and `.cache/replay-lineup-5667809143/`. They are not included
here. Python native/GLES controls additionally need the documented research
environment, its dependencies and a compatible ANGLE installation; the original
controls retain explicit machine-specific library paths rather than silently
selecting substitutes.

## Helper families

| Family                                      | Entry points                                                                                                                                                                                             | Scope                                                                                                                                                                                   |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser connection and functional playback  | `cdp-client.mjs`, `cdp-final-check.mjs`, `cdp-v39-final-check.mjs`, `cdp-v39-smoke.mjs`, `cdp-active-play-interaction.mjs`                                                                               | Actual viewer playback, captured served source bodies, pause/seek/camera/follow flows. The V39 final check adds the minion pre-movement seek sequence.                                  |
| Browser capture and video                   | `cdp-capture-sync-check.mjs`, `cdp-interaction.mjs`, `cdp-interleave-world-fx.mjs`, `cdp-record-playback-webm.mjs`, `cdp-projectile-screencast.mjs`, `cdp-screencast-gif.py`                             | Diagnostic images, compositor screencasts and ordinary-play video. Capture/readback overhead excludes these from clean FPS claims.                                                      |
| Message-flow and frame-cost analysis        | `cdp-worker-latency-trace-v38.mjs`, `analyze-worker-message-trace-v38.mjs`, `analyze-v38-gpu-hotspots.mjs`, `analyze-v39-r2-latency.mjs`                                                                 | Bounded instrumented Chrome flows and exact-owner offline timing joins. Correlation or cross-realm clock offsets are not isolated physical transfer/deserialization costs.              |
| Evidence closure and verification snapshots | `cdp-build-evidence-index.mjs`, `cdp-finalize-evidence-index.mjs`, `archive-v37.mjs`, `archive-v38.mjs`, `archive-v39-r2.mjs`, `check-v39-final-source.mjs`, `check-v39-r2-final-source.mjs`             | Version-pinned source/evidence inventories, content-addressed archive closure and local test/bundle snapshots. Historical inputs and unavailable versions remain explicit.              |
| Native no-alpha material controls           | `probe-no-alpha-mult-v39.py`, `probe-no-alpha-mult-stream-raster-v40.py`, `observe-no-alpha-mult-unit-context-v40.py`, `compare-no-alpha-mult-stream-v40.mjs`, `compare-no-alpha-mult-stream-v40-r2.mjs` | Original selector/reflection, supplied-context packed streams and controlled depth/cull/blend raster cases. These do not admit a production material or establish match-visible pixels. |
| Moving-parent numerical localization        | `analyze-no-alpha-bound-association-v40.py`, `analyze-no-alpha-bound-retained-delta-v40.py`, `analyze-no-alpha-bound-retained-delta-v40-r2.py`, `inspect-native-bind-blocks-v40.py`                      | Original retained-delta/center bytes, float32 association hypotheses and pinned instruction leaves. Full ordered state/checkpoint translation remains a separate gate.                  |
| Supporting fixture and document checks      | Remaining `cdp-*` probes, `inspect-v39-material-frontier.mjs`, `inspect-v39-r2-review.py`, `v38-inspect-*.mjs`, `lint-master-fidelity-doc.mjs`, `validate-master-fidelity-doc.mjs`                       | Smaller state inspections, image differences, fixed-fixture coverage inspection and document checks. Each retains its original narrow contract.                                         |

The provenance manifest lists the promoted helpers and directly authored controls.
Generated browser bundles,
syntax-transformed copies, third-party source, raw replays and browser profiles
are deliberately absent. One-off factories that rewrote another helper are also
omitted; their emitted authored controls are preserved directly.

## Browser commands

For ordinary interactive verification, follow the repository's PinchTab workflow.
These controls use CDP for the exact page/worker/source/GPU diagnostics they were
written to measure. They require an already running, owned isolated Chrome
instance on `127.0.0.1:9222` with exactly one page. They must not attach to a
personal browsing session. Start the prepared local viewer through the spike's
documented workflow before running them.

Always pass a fresh output stem for scripts that support one:

```powershell
bun sandbox/poc/league-spectator/replay/tools/research/cdp-v39-final-check.mjs http://127.0.0.1:4180 .cache/replay-spike/research/browser-local-comparison
bun sandbox/poc/league-spectator/replay/tools/research/cdp-active-play-interaction.mjs .cache/replay-spike/research/browser-local-interaction
bun sandbox/poc/league-spectator/replay/tools/research/cdp-record-playback-webm.mjs .cache/replay-spike/research/browser-local-video
bun sandbox/poc/league-spectator/replay/tools/research/cdp-initialization-gate.mjs http://127.0.0.1:4180 .cache/replay-spike/research/browser-local-initialization
bun sandbox/poc/league-spectator/replay/tools/research/cdp-replay-replacement.mjs http://127.0.0.1:4180 .cache/replay-spike/research/browser-local-replacement
```

The final check reloads/decodes the selected viewer, records world-only and
effects-enabled 1×/4× playback, then performs paused captures. The interaction and
video controls use the currently loaded viewer. Their screenshot/video/manual
readback overhead must remain separate from clean performance measurements.

The initialization control deliberately holds a static resource request while
checking disabled Play/seek controls, then releases it and verifies ordinary
playback. The held request is test instrumentation, not a measured loading time.

The replacement control selects the decoder's existing `endTime` input through
a diagnostic Worker wrapper: it loads 120 seconds, seeks to 110, then decodes
60 seconds from the same actual replay. It holds a model request across 30
rendered frames, clicks the partially loaded roster, releases loading, and
compares minion-wave jump camera matrices from two prior replay times. The
ordinary viewer source and strict replay-state bounds remain unchanged.

The worker-latency trace is historical despite its V38 filename: it explicitly
requires its recorded **runtime-program-37** page/reference graph. Do not remove
that assertion to run it against another runtime. A new diagnostic needs its own
versioned control and matching source graph.

## Native and offline analysis commands

Use the prepared native research Python environment and the exact pinned inputs:

```powershell
.cache/replay-spike/research/venv/Scripts/python.exe sandbox/poc/league-spectator/replay/tools/research/probe-no-alpha-mult-v39.py
.cache/replay-spike/research/venv/Scripts/python.exe sandbox/poc/league-spectator/replay/tools/research/probe-no-alpha-mult-stream-raster-v40.py
bun sandbox/poc/league-spectator/replay/tools/research/compare-no-alpha-mult-stream-v40-r2.mjs
```

These are independent, versioned research controls, not an unconditional success
pipeline. The current moving-parent comparison intentionally reports a remaining
numerical mismatch; shader/reflection success cannot turn that into admitted
coverage. Do not change asset graphs, seeds, expected digests or tolerances merely
to make a control pass.

Archives and fixed-version proof scripts require their recorded prerequisite
reports and reject existing immutable output where that guard is implemented.
Several smaller historical probes have fixed output paths and are not generic
rerun commands. Before execution, inspect the script's input/output contract;
preserve existing evidence and create a separately identified new control when
inputs, source or purpose change. Never delete an old result to rerun it in place.
Historical absolute source paths in an archive remain historical identities;
`inspect-v39-r2-review.py` maps its current source back to the original archive key.

No heavy native observation, full replay, GPU raster or live browser run is implied
by the source promotion checks. Syntax/import validation establishes only that
the promoted helper sources parse and their static local imports resolve.
