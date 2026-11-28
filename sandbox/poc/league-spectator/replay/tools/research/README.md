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

The missile-family adapter regression can use an explicitly selected read-only
fixture cache when running in a different worktree:

```powershell
$env:SCOUT_REPLAY_RESEARCH_CACHE = '<approved-cache>'
bun test sandbox/poc/league-spectator/replay/latest-direct-missile-family-adapter.test.mjs
```

Without that test-only input it uses the worktree's `.cache/replay-spike`.
A missing or incompatible selected fixture fails; the test does not search other
caches, copy resources, or skip assertions.
The selected-material pixel inventory regression uses the separate retained
lineup cache. Set `SCOUT_REPLAY_LINEUP_FIXTURE_CACHE` to that exact cache root
when it lives in another worktree. Its default remains
`.cache/replay-lineup-5667809143`; an empty override or missing selected fixture
fails with all assertions intact.

## Recorded champion health

The extractor supports 16.23.840.6595 and 16.23.841.8428. It projects current and
maximum champion health from group 32 of replication opcode 309, using champion
IDs from an independently bound `scene.json` for the same replay SHA-256.
Points follow the main playback stream. The roster and overhead gauges hold the last observed values when
seeking or playing. The overhead gauge uses the model's bind-pose bounds and
the Scout scene camera.

Run the extractor with the archived macOS executable, saved ROFL, and bound
scene from an initial private terrain package. The archive is read as data.
To check each extracted health group with the original x86-64 registration,
reader, and getters, include the optional group file and run the Unicorn probe.

```powershell
bun sandbox/poc/league-spectator/replay/tools/research/recorded-champion-health.mjs $macGameExecutable $replayPath $boundScene $healthTracks $healthGroups
uv run --no-project --with unicorn python sandbox/poc/league-spectator/replay/tools/probe-exact-champion-health.py $macGameExecutable $healthGroups $healthReceipt
```

## Recorded champion resources and gold

The resource extractor supports the same two exact builds. Its native
probe registers the original group 1 and 32 layouts, consumes the full
recorded groups, and compares spendable gold and primary resource values
against their original getters. The roster displays the latest recording at
or before the replay clock. Zero resource capacity omits the meter.

```powershell
bun sandbox/poc/league-spectator/replay/tools/research/recorded-champion-resources.mjs $macGameExecutable $replayPath $boundScene $resourceTracks $resourceGroups
uv run --no-project --with unicorn python sandbox/poc/league-spectator/replay/tools/probe-exact-champion-resources.py $macGameExecutable $resourceGroups $resourceReceipt
```

## Recorded champion experience

The experience extractor reads the recorded champion experience, level,
and individual level-cap changes. The native probe decodes the original group 32
layout and checks both values against the original component getters. Use
fresh output paths and a bound scene for the same replay.

```powershell
bun sandbox/poc/league-spectator/replay/tools/research/recorded-champion-experience.mjs $macGameExecutable $replayPath $boundScene $experienceTracks $experienceGroups
uv run --no-project --with unicorn python sandbox/poc/league-spectator/replay/tools/probe-exact-champion-resources.py $macGameExecutable $experienceGroups $experienceReceipt --progression
```

Use `--current` as the first argument to both Bun extractors in this section
for 16.23.841.8428 and use the matching macOS archive in the native probes.

The private package builder checks the tracks against the original
`data/maps/shipping/map11/map11.bin` WAD entry and follows the CLASSIC mode
link to the authored thresholds. The roster samples the tracks at the replay
clock, applies recorded changes to each champion's cap, and keeps total XP
visible when a champion reaches their cap.
Repeat the native probe with a fresh receipt and
`--experience-scene $preparedScene` to compare each prepared progress
sample against the original experience calculation.

Generate a separate receipt for the original level-cap packet reader,
including the saved overrides and each supported payload selector.

```powershell
bun sandbox/poc/league-spectator/replay/tools/research/recorded-champion-level-cap.mjs $replayPath $boundScene $capPackets
uv run --no-project --with unicorn python sandbox/poc/league-spectator/replay/tools/probe-exact-champion-level-caps.py $macGameExecutable $capPackets $capReceipt
```

## Recorded inventory

The recorded inventory artifact supplies the seven playable slots at each
observed change. It folds ordinary events from the opening native snapshot and
checks each player's final slots against the original replay footer. The
chronology audit records discrepancies at later native checkpoints.

Use the pinned resource tracks and a bound scene for the exact same ROFL. Use
fresh output paths for the native input, proof, audit, and tracks.

```powershell
$tools = 'sandbox/poc/league-spectator/replay/tools'
bun "$tools/research/extract-exact-inventory-set.mjs" $replayPath $resourceTracksJson $inventoryNativeInput --all
uv run --no-project --with unicorn python "$tools/probe-exact-inventory-mutations.py" $macGameExecutable $inventoryNativeInput $inventoryNativeProof
bun "$tools/research/audit-exact-inventory-chronology.mjs" $inventoryNativeProof $replayPath $boundScene $inventoryAudit $inventoryTracks
```

For 16.23.841.8428, use the bound scene and the exact macOS archive. The
chronology audit compares the terminal slots with the saved replay and the
reviewed Riot Match-V5 result. Supply the SHA-256 pins for the exact inputs.

```powershell
bun "$tools/research/extract-exact-inventory-set.mjs" --current --all --replay-sha256 $replaySha256 --scene-sha256 $boundSceneSha256 $replayPath $boundScene $inventoryNativeInput
uv run --no-project --with unicorn python "$tools/probe-exact-inventory-mutations.py" --current --source-sha256 $inventoryNativeInputSha256 $macGameExecutable $inventoryNativeInput $inventoryNativeProof
bun "$tools/research/audit-exact-inventory-chronology.mjs" --current --native-proof-sha256 $inventoryNativeProofSha256 --canonical-match $matchV5Path --canonical-match-sha256 $matchV5Sha256 $inventoryNativeProof $replayPath $boundScene $inventoryAudit $inventoryTracks
```

Compare the portable reader with the native receipt and the ordered inventory
tracks by passing the prepared motion decoder bytes as the final argument.

```powershell
bun "$tools/research/verify-recorded-inventory-fold.mjs" $replayPath $boundScene $inventoryNativeProof $inventoryNativeProofSha256 $inventoryTracks $inventoryTracksSha256 $preparedMotionDecoder
```

Collect the unique positive `itemId` values from the seven-slot arrays into a
JSON array. Build the `terrain-texture-mips` utility and pass its DLL to the asset
preparer. The preparer reads names and icon textures from the exact local game
archives and exports the original top mip as PNG. Add `--current-build` for
the verified 16.23.841.8428 installation.

```powershell
bun "$tools/research/prepare-exact-inventory-assets.mjs" $installation $itemIds $outputDirectory $terrainTextureMipsDll
```

For the current build, list exact archived sources without exporting image
files. The private index reports the verified name and texture digest for
each indexed item and a reason for each unavailable item. Prepared PNGs
remain required for the viewer.

```powershell
bun "$tools/research/prepare-exact-inventory-assets.mjs" --current-index $installation $newPrivateItemIndex
```

## Original Map11 ground queries

The viewer uses the initial Map11 navigation grid for champion ground
placement and free-camera targets. The offline probe loads the archived
grid through the original loader. The comparator checks the browser
sampler against the original Float32 height and bounds results. It also
checks that the prepared scene uses the same grid bounds, step, and height
bytes. Use a nonempty JSON array of world `[x, z]` coordinates for
`$groundRequests` and write the receipt to a fresh path under `.cache`.

```powershell
uv run --no-project --with unicorn python sandbox/poc/league-spectator/replay/tools/research/probe-exact-terrain-ground.py $macGameExecutable $map11Navgrid $groundRequests $groundReceipt
bun sandbox/poc/league-spectator/replay/tools/research/verify-exact-terrain-ground.mjs $preparedScene $preparedHeights $groundRequests $groundReceipt
```

## Map11 ground decals

The Map11 material preparer verifies the original blend flag and all four
blend factors on the two Gromp ground decals. Its manifest carries that
binding through to the browser. The terrain renderer composites their
straight-alpha textures over the opaque terrain pass and restores
depth-write and blend state before drawing models. The recorded Playwright
run checks both decal draws and their factors on the opening and late
match views. Set `SCOUT_REPLAY_E2E_EXPECT_GROMP_DECALS=1` when testing a
fresh material export to require both bindings in the package.

## CLASSIC follow camera defaults

Pass `--camera-globals $cameraGlobals` to the private package builder.
Supply the `globals` entry from the original 16.23.840.6595
`DATA/FINAL/Global.wad.client`. The builder verifies the archive entry's
digest and CLASSIC camera record before applying the original baseline to
champion follow. The browser replay test measures the 40° vertical field
of view, 50-unit near clip, 56° pitch, neutral heading, and
2,306.10546875-unit eye distance in the view-projection matrix. The
far plane uses the original 10,000-unit setting fallback plus 2,250 units
of configured distance. Scout scales the distance term by the same ratio
as its follow zoom. Native input handling, camera target movement, and
live preference overrides remain unverified.

```powershell
uv run --no-project --with unicorn python sandbox/poc/league-spectator/replay/tools/research/probe-exact-classic-camera-lens.py $macGameExecutable $cameraLensReceipt
```

The probe executes the original constructor, pose, clipping calculation,
and projection code at multiple aspect ratios. It captures the original
setting key and fallback. A modeled setting provider returns that fallback
at two camera distances and supplies a different value to confirm an
override propagates. It rounds modeled trigonometric results to Float32.

## Archived champion skin census

Run from the repository root with the exact saved 16.23.840.6595 or 16.23.841.8428 Windows
installation and a fresh directory under the private `.cache`.

```powershell
bun sandbox/poc/league-spectator/replay/tools/prepare-native-terrain-champions.mjs --archive-census $archivedInstallation $newCensusDirectory
```

The census checks the executable digest, reads the canonical champion archive
indexes and verifies each matching typed `SkinCharacterDataProperties` root.
It records archive index digests, skin BIN digests, and the mesh, rig, texture,
and material override references. It scans skin IDs 0 through 10,000. The
archive includes mode-specific entries such as TFT and requires an independent
selection legality inventory before use in public replay admission. Linked
asset bytes and model conversion require their own verification.

For a build-scoped 16.23.841.8428 catalog, supply a pinned selection JSON to
`--prepare-archived-skins` with schema 1, kind
`exact-native-terrain-skin-selection`, the exact build and protocol, and a
`skins` array of `{ champion, skinId }` entries. The preparer resolves each
entry against the pinned census. The `--archive-catalog` model converter checks
the pinned inputs and installed archive indexes. The package builder binds
models by the exact skin selectors in the replay's opening packets.

Generate a build-wide selection with the exact archive census and Riot's
patch-matched `championFull.json`. The selector verifies both input hashes
and every listed skin key, and excludes archive-only entries. `--base-only`
selects default models after verifying the same complete list.

```powershell
bun sandbox/poc/league-spectator/replay/tools/research/select-listed-terrain-skins.mjs `
  $archiveCensus $censusSha256 $championFull $championFullSha256 > $skinSelection
```

Pass the emitted selection and its SHA-256 to `--prepare-archived-skins`
before model conversion. The selection establishes archive membership.
Model rendering, queue eligibility, and public admission have separate checks.

## Recorded Map11 announcements

The extractor walks all saved streams for opcode 880. The native probe
checks that the original packet reader consumes each complete body and
reads the announcement enum and its registered name. The receipt records
the packet context, physical order, and replay timestamp. It leaves
dynamic sound selection and playback outside the packet check.

For 16.23.841.8428, the portable reader in
`native-terrain-announcer-reader.mjs` decodes complete opcode 880 envelopes
for comparison with the native receipt. The collector accepts an
independently verified Map11 event-to-media mapping and reports omitted
events. It does not make the native spectator audio admission decision.

```powershell
bun sandbox/poc/league-spectator/replay/tools/research/extract-exact-announcement-packets.mjs $replayPath $announcementPackets
uv run --no-project --with unicorn --with capstone python sandbox/poc/league-spectator/replay/tools/probe-exact-announcement-packets.py $macGameExecutable $announcementPackets $announcementReceipt
```

## Archived Map11 static geometry

`../prepare-map11-scene.mjs` prepares an explicitly selected Map11 geometry
variant from the pinned 16.21 archive. It does not read a replay or admit Map11
spectator playback. Supply the retained RMAN-parser checkout, approved source
cache, isolated output cache, explicit geometry variant and .NET executable:

```powershell
bun sandbox/poc/league-spectator/replay/tools/prepare-map11-scene.mjs <lol-exe-downloader-checkout> <approved-cache> <map11-cache> base_srx <dotnet>
```

The isolated cache must contain `release.manifest` matching the release identity
and SHA-256 declared in `../map-scene-assets.mjs`. The producer range-reads its
Map11 WAD, verifies the retained geometry exporter receipt, and decodes original
material BIN bytes locally. `../exact-map-bin.mjs` admits only the observed PROP
v3/16.21 format, checks every section boundary, and preserves the class-specific
64-bit hash fields without a legacy retry. Its pinned format reference and
source hash are recorded in the typed output. WAD path hashes retain their
original 64-bit identity through `read.byHash`, independently of textual paths.

RMAN cache reuse requires a release-scoped receipt binding the source manifest
SHA-256, manifest/chunk/bundle IDs, exact HTTP range, compressed and expanded
sizes, and both byte digests. Unreceipted legacy bytes are fetched again once;
an existing receipt or payload mismatch fails without a download fallback.
The complete-controller materializer explicitly uses location-scoped cache
entries: the same opaque chunk ID can appear at several bundle ranges in one
manifest. It proves each location against the original bundle table, reuses
exact matching legacy receipts, and independently fetches a different admitted
range into a separate namespace. It validates the old receipt and payload before
doing so and preserves both; corruption still fails without a fetch. The default
chunk reader retains its original strict identity contract.
`../rman-range-precache.mjs` can populate absent entries from contiguous original
bundle ranges, bounded by 8 MiB and 1,024 chunks with four requests in flight.
It checks the exact source membership and HTTP range, validates every expanded
chunk before writing a batch, and retains compressed/expanded chunk digests plus
the actual parent transport range and digest. Exclusive writes preserve existing
cache evidence; cached corruption remains an error in the strict reader.
The output embeds every used chunk receipt. WAD v3.1–3.4 entries additionally
verify xxh3 of stored bytes before decompression, including the subchunk table
and each subchunked entry. These checks do not infer a chunk-ID hash algorithm.

`../materialize-archived-controller-bootstrap.mjs` inventories or materializes
the original Windows executable and the complete DATA, Global and Bootstrap
WADs into a fresh private installation. `../materialize-archived-script-archive.mjs`
extends an explicitly supplied complete bootstrap receipt with the original
Scripts WAD. It verifies and copies each original parent file and subchunk table,
then downloads and reads back the complete Scripts bytes. Neither changes the
parent installation or claims native WAD signature admission; that remains an
original native archive-registration gate.

Each invocation uses a fresh namespace beneath `<map11-cache>/prepared` and
prints its output path only after writing its final manifest. Source and output
caches must be canonically disjoint, including junctions and missing descendants.
Failed attempts have no final manifest and cannot contribute stale files to a
later inventory. No previously prepared output is deleted or reused.

The run's `public/map11-scene` includes geometry, heights, original material
bytes and typed metadata, diffuse texture previews, explicit unsupported material
reasons and a hashed file inventory. Its manifest declares
`partial-static-map-geometry-only` and denies spectator admission. The exporter's
base visibility mask, diffuse approximation, recorded-variant uncertainty and
missing world/entity/lifecycle support remain separate requirements. Existing
Map12 world/catalog approvals cannot be reused merely by changing a map ID.

## Original CLASSIC camera inputs

`../prepare-original-camera-inputs.mjs <complete-shader-installation-manifest.json> <approved-source-cache> <fresh-output-directory>`
extracts `Globals/CameraConfig_CLASSIC` from the complete original Global WAD.
It verifies the archived release, executable, complete archive, exact `globals`
BIN and metadata annotations before preserving the original field spans. Its
output directory must be fresh and outside the retained source and installation
roots. Missing properties stay absent; annotated field names are not defaults.

`../probe-original-camera-config.py <native-package> <original-client> <camera-input-manifest.json> <fresh-output.json>`
registers the original embedded `CameraTrapezoid` descriptor before the original
`CameraConfig` descriptor, then runs the actual constructor and typed reader.
It checks all fourteen authored scalar leaves against their original float
bytes, including embedded fields, and requires repeated constructor output to
match. Consuming all serialized bytes alone is insufficient: an unregistered
embedded descriptor can consume a field without populating its destination.
Omitted defaults come from the original constructor. This is a camera-data
control; motion, projection, input response and browser/native spectator
equivalence remain separate requirements.

`../probe-archived-camera-resource.py <assets> <original-client> <archived-installation> <fixture-cache> <fresh-output.json>`
runs the unchanged signed DATA/Global/Bootstrap/controller control before loading
the explicit `globals` resource through the original binary cache. Loader success
does not establish complete decoding of every class in that library. Optional
`--typed-camera-control <camera-constructor-output.json>` additionally runs the
original CLASSIC fallback branch's hashing, cache lookup, RTTI and publication,
then the original camera allocation/constructor caller. It does not execute the
preceding game-mode selection. All 157 initialized camera-config bytes must match
the independent typed control. The final three bytes are padding: two poisoned
placements prove the constructor leaves them and neighboring memory unchanged.
The comparison separately rejects changed initialized fields, including the final
boolean, and records padding differences without interpreting them as data.

## Recorded Map11 terrain visibility

The offline workflow uses the saved 16.23.840.6595 ROFL, the matching archived
Mac executable as input bytes, the original Map11 navigation grid, the audited
Map11 export, and `base_srx.materials.bin` from the same archived installation.
The Python probe needs Unicorn and uses the same Mach-O and navgrid harness as
the terrain fog probes. Run from the repository root with fresh output paths.

```powershell
$tools = 'sandbox/poc/league-spectator/replay/tools'
bun "$tools/extract-exact-map11-controller-inputs.mjs" $savedRofl "$geometry/map.json" $originalBaseSrxMaterials $newInputJson
& $pythonWithUnicorn "$tools/probe-exact-map11-controllers.py" $archivedMachO $originalNavgrid $newInputJson $newVisibilityReceipt
```

For the base package, `$geometry` is the audited Map11 directory. Prepare its
reviewed materials with the command below. `$terrainTextureMipsDll` is built
from `../terrain-texture-mips/TerrainTextureMips.csproj`. The installation
argument supplies static archives for texture extraction.

```powershell
bun "$tools/prepare-native-terrain-materials.mjs" $archivedInstallation $geometry $terrainTextureMipsDll $newPrivateMaterialDirectory
```

For the expanded Infernal package, first export the three reviewed replacement
meshes from the complete original `map.mapgeo`, whose SHA-256 is
`d6d8d434b977ee43bbc05aeb61d586476c692585da9cf7b2971906091539d1a5`.
Use the resulting directory as `$geometry` in **both** commands above.

```powershell
dotnet run --project "$tools/exporter/Exporter.csproj" -- map $originalMapGeo $newInfernalDirectory infernal-overlays
$geometry = $newInfernalDirectory
```

Append `--terrain-materials <materials.json> --terrain-visibility <receipt.json>`
to the existing Scout scene command for `../serve-native-terrain.mjs`. Keep the
original audited directory as the first positional argument. For the expanded
pair, also pass `--infernal-terrain-export <expanded-directory>`. A private
package can also pass `--camera-globals <globals-entry>` for the separate
CLASSIC camera control.

The preview checks the receipt's complete SHA-256 and binds its contents to the
saved replay SHA-256, build, protocol, geometry metadata and original material
BIN. Use the matching package and match pair. The expanded export also checks
both mesh digests and preservation of the original geometry prefix, and
requires its matching prepared material manifest.

| Saved match | Base visibility receipt SHA-256                                    | Expanded visibility receipt SHA-256                                |
| ----------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Short       | `f4cca91d895b984af25b5ce76814ad09a230571660265cda8f69dca7950fc0dc` | `41e89c0f415121960d48ab1f9930a2e29f2c650f3ac51ad2516697be6f3e91e8` |
| Long        | `39970872e3dda6634c1389be84947fd06d7305c7d519558d9dd248e43517b766` | `060b9ea9cd7228f81c78f89979b426782b3a1342d02420466b86f85933f154db` |

The expanded `map.json` SHA-256 is
`4a8b2432fa3316647092fee062ff84c198f5e085ea11860aa4584082f46a889d`.
The `map.bin` SHA-256 is
`c0419c77f44277f4e0257c1dae73a24d355461b87640318231e351cba208c61c`.
The prepared expanded `materials.json` SHA-256 is
`c4ccce86cabfe3f8c47e39eb60588c35ff605c75dd118d0fd898f99f9eea1340`.

The original controller initialization, opcode 80 updates and composite reads
agree with 552 saved snapshots and 10 ordinary updates across the two matches.
Earth and Ocean terrain stay hidden in both recordings. The long match enables
an Infernal controller at 761.784796875 seconds with no mesh in the audited
Map11 geometry.
At 762.051796875 seconds, the controller for the three reviewed replacement
meshes enables them as the outgoing dragon-pit composites hide. The base
package retains that outgoing terrain because its export lacks the replacement.
The preview samples controller state at the replay time, including after seeking
back across a transition.

The two configuration-only trophy controllers, SR Worlds Trophies and
SR Hall of Legends, retain legacy visibility and appear in the scene's
unresolved controller list. Expanded Fire draws use the authored geometry and
diffuse bindings. Full Fire shader output, including flow and emission, Ocean
Puddle's transparency animation, general vertex deformation and Faelights
material support remain outside this proof.

### Infernal Order Fire shader inputs

`Order_Dragon_Fire_A_MAT` and `Order_Dragon_Fire_B_MAT` select shader
`eff08973`, `Shaders/StaticMesh/DefaultEnv_Flat_AlphaTest`, in the archived
`data/shaders/shaders.bin` from `DATA/FINAL/Global.wad.client`. The shader
declaration archive SHA-256 is
`53cc9efa406ab00a9423941d78daac663d4986d3046cc9110afbb9b3b99a22c6`.
The declaration contributes `FEATURE_MASKED=1`. Both authored materials
contribute `DISABLE_DEPTH_FOG=1`, `NO_BAKED_LIGHTING=1`, and
`PREMULTIPLIED_ALPHA=1`. Both list the `MULTIPLY_ALPHA` toggle without a
serialized value. The current native descriptor at `0x183b231` registers its
value at offset `0x10`, where initializer `0x182d060` writes true.

To reproduce the archive comparison with the matching local WAD, read the
following entries by 64-bit path hash from
`DATA/FINAL/ShaderCache.dx11.wad.client`.

| Entry                           | Path hash          | SHA-256                                                            |
| ------------------------------- | ------------------ | ------------------------------------------------------------------ |
| Pixel TOC with `MULTIPLY_ALPHA` | `e68b5c9380b107e3` | `9ce59b664ac43d53733cbef7401da69d8d42620d5bddac91a0c4a099ce4d8acd` |
| Matching pixel bundle candidate | `1d03a4dd573205ed` | `bf9384f963b6910de4c9b4b76ab5d786c422b4a0c9778ad46e515cde8a583944` |

Hash the concatenated, alphabetically ordered `name=value` strings with
XXHash64. The five authored and shader-declaration defines above give TOC ID
148 before any runtime fog or shadow defines. The archive bytecode candidate is
slot 48 in the second bundle, offset 261588, length 5888, with SHA-256
`0b67eb57649feb7b69e3e525c5e354d68dd02f2a3ab774d9dd0fc9fe73ea5d09`.
Read each bundle slot as a little-endian 32-bit length followed by its payload
and use the DXBC size at payload offset 24 to remove padding.
`D3DDisassemble` shows a strict discard of sampled alpha below
`AlphaTestValue` (authored value 0.3), a sampled RGB times sampled alpha
operation before tint, and the sampled alpha forwarded in the primary output.
IDs 182 and 183 in the same TOC and slots 82 and 83 in the candidate bundle
give a control for `MULTIPLY_ALPHA=0` and `1` with `FEATURE_MASKED=1`.
The multiply is present only in the latter control.

The two decoded diffuse base mips contain only alpha 0 and 255, with black RGB
at alpha 0. This does not remove the shader's alpha multiplication after
texture filtering. The authored RGB and alpha blend factors resolve to
`ONE, ONE_MINUS_SRC_ALPHA` in both channels. The stock pass constructor
initializes depth testing to enabled and its authored write mask to `0x1f`.
Final native pass-to-device binding, depth-write behavior, draw order, and
runtime fog and shadow permutation selection remain unverified. The ground
Fire material uses a separate shader and does not share this alpha path.

## Native Director startup eligibility

From the replay directory, extract the pinned opening roster and run the
archived native startup wrapper through the first candidate scoring call.

```powershell
bun tools/research/extract-exact-director-framing.mjs $savedLongRofl $macGameExecutable $openingRosterJson
uv run --no-project --with unicorn python tools/probe-exact-directed-camera-first-update.py $macGameExecutable $openingRosterJson $startupReceiptJson
```

The receipt records nine blocking controls and two eligible controls with
projected runtime clocks, readiness, and camera mode. Its first visited actor
identifies the roster entry passed to the scorer. The actual first match update
and winner require the original readiness and clock transitions, complete actor
and world state, and the director's evolving score accumulator and incumbent
focus. This probe leaves the browser's Directed camera capability closed.

The health and proximity probes execute two original score terms against the
pinned roster samples. The health probe also requires the long replay's
verified health tracks. Each command writes a fresh receipt.

```powershell
uv run --no-project --with unicorn python tools/probe-exact-directed-camera-health-score.py $macGameExecutable $openingRosterJson $healthTracksJson $healthReceiptJson
uv run --no-project --with unicorn python tools/probe-exact-directed-camera-proximity-score.py $macGameExecutable $openingRosterJson $proximityReceiptJson
```

The health term adds zero for full-health Renekton at opening. At
78.45333099365234 seconds it adds 49 using the latest recorded health and one
nearby living enemy, or 24 in a control with the enemy roster marked dead.
The proximity term contributes 50 for the nearby Renekton–Urgot pair with
Recall projected inactive and 100 with its Recall flag set. The receipts
record the projected liveness, Recall flags and score seeds separately from
the replay values. Actual Recall state and the combined ranking remain open.

## Original cold texture defaults

For an original particle color proof whose asset paths belong to an archived
checkout, pass `--particle-color-recovery` to
`../prepare-complete-quad-gpu.mjs`. Give it a JSON file with
`recordedAssetRoot`, the original absolute public asset root, and `sourceRoot`,
the absolute directory of recovered native Python sources. The quad builder
resolves the archived asset paths under its own `public` directory and checks
the original proof and every input digest.

`../observe-original-particle-default-textures.py` executes original null and
interned-empty texture-name controls for the selected slots, retaining the
original wrapper/getter and complete GPU byte readback. The separate
`../observe-native-shader-global-fields.py` reads the original Shared shader BIN
fields, fixes their typed references, and executes the actual cold remap row's
registration and initialization. Its isolated graphics bridge runs the original
sampler/cache code over owned descriptor objects and creates queried GLES sampler
state. Unsupported address/comparison capabilities fail before publication.
It does not implement the Metal driver or live color-remap updates.

`../prepare-scene-cold-default-textures.mjs` publishes those proof bytes and
their native pixel projections into an independent immutable authority.
`../../scene-cold-default-textures.mjs` validates the exact native recipes,
byte readbacks and semantic routes before constructing a binding. A named
authored texture cannot use an absent-resource default. The shader semantic
`PARTICLE_COLOR_TEXTURE` has a separate empty-name proof: the original caller
reads the emitter's color string, supplies slot 1, and agrees with the original
shader-name table. Both native pixelation branches and all authored address
modes are observed before applying its absent-name resource. The schema-2
authority admits this route only for an empty authored color string; named
color resources require their own source binding. A neighboring white-slot
control alone cannot establish that relationship.
`../inspect-scene-cold-default-textures.mjs` exercises the actual
factory and rejects changed projections, missing proofs, unproved semantics and
unsupported sampler data. These cold component resources establish neither live
scene predicates nor match rendering or spectator admission.

`../inspect-scene-cold-renderer-resources.mjs <closed-public-root> <pinned-three-module> <fresh-proof-directory>`
checks the actual selected catalog, material registry, renderer and texture
objects together. It compares every source PNG projection and cold-default
pixel, and rejects altered or foreign bindings. This resource control does not
establish WebGL submission or effect-simulation admission.
`../serve-cold-material-control.mjs` serves a separate loopback browser component
page with the same restrictive Scout CSP and explicitly supplied test geometry.
Its arguments are the closed public root, pinned Three module, fresh proof
directory and optional unprivileged port. Only catalog-declared resources and
the bootstrap's immutable base profile are served; consumed bytes and source
drift are recorded separately. A successful component draw still does not admit
that emitter to replay simulation or prove match-visible rendering.

The archived BIN annotator labels original emitter field `3d7e6258` as `color`,
while the retained CDTB dictionary labels that same field `Color`. The direct
compiler normalizes only those two known labels on `VfxEmitterDefinitionData`.
It preserves authored values, including invalid declarations for subsequent
validation, and rejects a graph containing both labels. It does not perform
general case folding or add support for a new curve type.
`../inspect-emitter-color-field.mjs <approved-source-cache> <archived-fx-inventory> <output.json>`
re-reads the original raw BINs and checks their class, embedded `ValueColor`
field, pinned annotations and legacy dictionary before comparing that projection.
The same source control checks root HASH `1d369c29`: the archived annotation
retains its hash label, while the checked legacy dictionary calls it `objectPath`.
The compiler projects that exact label and then applies its existing authored
identity check; a foreign hash or duplicate label still fails.

`../probe-scene-particle-orientation.py <native-package> <original-client> <effects-root> <field-input-root> <fresh-output.json> --component <effectId:index>`
executes complete original typed emitters, postload, updates and arbitrary-quad
writers. Its paired control varies only the serialized particle-local boolean.
All seven supplied affine bases are exercised while particles remain alive,
including a nonidentity basis at birth, with the full pristine math initializer
executed after each reset. The bounded direct program supports a single bound
arbitrary quad with constant birth rotation and no authored shape or motion.
For that slice it applies the current root basis to both local position and
rotation axes, keeping the world birth origin and anchor translation separate.
Other shapes, motion, UV and material dependencies keep their own admission gates.
`../compare-scene-particle-orientation.mjs <closed-public-root> <native-output.json> <comparison.json>`
compares actual source-owned runtime geometry, packed attributes, retained pool
and RNG, with pause, seek, speed and forged-program controls. The optional fifth
argument to `../inspect-selected-material-renderer.mjs` accepts that same native
control and checks the resulting real material-backed THREE geometry. These
explicitly supplied component inputs do not establish an actual replay basis,
parent activation, WebGL submission or native spectator admission.

## Helper families

### Shared replay preparation

`../../latest-direct-effect-session.mjs` exports
`prepareLatestDirectEffectSessionInputs(options)`. Ordinary playback and offline
controls use the same targeted-missile implementation, owned pose resources,
initial resource policy, world queries, event construction and compiler. Its
result contains live `prepared`, `events` and `presentationWorld` values;
compiled kernels and capabilities must not be serialized and restored as plain
objects. Default playback retains fetch and its actual preparation worker.
Tool callers can supply explicit resource I/O and invoke the exported worker
preparer directly, without supplying placement or substituting controller state.

`makeWorkerInitialization()` issues the original projected payload and transfer
capabilities exactly once. A rejected transfer attempt also consumes its ticket.
The resource loader has a separate lexical scope; the issuance closure releases
its report, events and pose holder before minting. Ordinary playback drops its
preparation wrapper after synchronous posting. Keeping a diagnostic preparation
result intentionally retains its live data until the caller releases it.

`../direct-replay-preparation.mjs` provides
`prepareDirectReplayFromFiles({publicRoot,reportPath,threeModule,outputDirectory,selectionMode})`.
`selectionMode` explicitly chooses `catalog` or the preserved `legacy` fixture
contract. It returns `runtimeInputs`, live preparation results and a source-bound
runtime constructor pair sharing the compiler's module-instance registries.
The pair's event-ownership factory must mint its own event tickets; a capability
from a separate module instance is foreign even when its source bytes match.
`assertInputsUnchanged()` rechecks consumed input and source hashes.
`../inspect-direct-replay-initialization.mjs` compares actual event, program,
policy and world inputs against an explicitly captured preparation baseline.
`../compare-direct-replay-checkpoints.mjs` compares complete ordered state and
geometry with only the checkpoint-cache policy changed. These are offline
correctness controls, separate from browser/GPU or spectator acceptance.

`../extend-selected-scene-session-config.mjs` extends an existing explicit
`{plan,roots,roles}` selection with independently approved fixed build programs
and the selected scene's exact world, packet, corpse and neutral programs.
Optional effects-source input is an explicitly supplied matching package root.
Reference roles have separately declared target paths retaining the original
approved source bytes. Publish the resulting configuration to a fresh root with
`../prepare-selected-scene-catalog.mjs`; original parent receipts stay unchanged.
Selected consumers read declared roles, including resource contexts and scene
animation rigs. Missing roles fail instead of searching an older asset tree.

Animated pose metadata distinguishes an explicit null base-state selection from
corrupt or absent state metadata. A null `idle` or `run` declaration yields
`pose:base-animation-state-program-unavailable`, retaining entity, clock and
causal cursor evidence without evaluating a graph or writing transforms.
Animated groups remain hidden, including after later visibility updates; static
skeleton/clip loading alone does not admit an actor pose. Installed-key, root,
orientation and placement checks remain independent, and unsupported poses do
not supply a default attachment basis or a substitute animation.

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

### Reproduce the recorded team-visibility tracks

Pass the saved long Summoner's Rift replay for build `16.23.840.6595`, its
matching macOS client executable, and a Python interpreter with Unicorn. For
world units and structures, pass a matching private terrain scene to select
its admitted contexts. The verifier runs offline and reads the executable
as bytes.

```powershell
bun sandbox/poc/league-spectator/replay/tools/research/verify-exact-team-visibility.mjs $savedRofl $macGameExecutable $pythonWithUnicorn $newProofJson $newTracksJson $existingSceneJson
```

Use the printed track SHA-256 with the terrain preview's team-visibility
input. The proof includes archived gain and loss requests for both teams,
the exact native constructor and selected-view check, and a comparison
between reconstructed champion masks and the archived snapshots. Track
queries use the opening snapshot and continuous gameplay clock, including
same-clock updates in packet order. Full snapshot restoration, live
component registration, and the terrain fog surface remain unverified.

### Recorded champion animation cues

From the repository root, prepare a private cue package for either of the
reviewed saved `16.23.840.6595` recordings. Pass the original ROFL, the
digest-pinned universal macOS executable archive as a data file, and the
champion extraction and ordinal model manifests for that same replay.
The exact Windows installation supplies local WAD asset bytes. Bun and
`uv` are required.

```powershell
bun sandbox/poc/league-spectator/replay/tools/research/prepare-recorded-animation-cue.mjs `
  $installation $originalRofl $macArchive $championManifest $ordinalModelManifest `
  .cache/reviewed-animation-cue
```

Use a new output directory under `.cache`. The producer verifies the recorded
actor identity and packet location, executes the original reader and name
hash in Unicorn, resolves the linked skin graph and Atomic clip in the WAD,
and bakes the matching original rig through the existing native pose probe.
It writes `scout-animation.json` last, beside its digest-pinned rig, ordinal
bindings and packed clip. Long replay coverage is Wukong skin 5 `Spell1`
at 47.51853248596191 s. Short replay coverage is Jinx skin 60
`Exalted_Spawn` at 1.509 s.

For the reviewed long recording, pass the existing `AnimationPack.dll` from
the ordinal animation exporter to prepare all eligible requests in one pass.
Its LeagueToolkit assembly must match the ordinal model manifest.

```powershell
bun sandbox/poc/league-spectator/replay/tools/research/prepare-recorded-animation-batch.mjs `
  $installation $longRofl $macArchive $championManifest $ordinalModelManifest `
  $animationPackAssembly .cache/reviewed-animation-batch
```

The batch accepts direct request flags 0 and 16 with positive recorded rates
and zero adjustment and override fields. It resolves exact atomic graph keys
and shares clip files by original animation and rig digest. Compressed v1
clips use the archived evaluator. Uncompressed v5 clips use the existing
ordinal exporter. The window ends at the earliest of the rate-adjusted clip
end, the next direct request for that actor in packet order, or the match end.
A later request at the same clock gives the earlier request an empty window.
The receipt pins the omission inventory and prints its own SHA-256 for the
private package builder. The reviewed long replay includes 275 windows across
Wukong, Warwick, and Galio, using 13 authored clips.

The cue windows are for isolated authored-pose reconstruction. The native
activation gate, the blend from the prior pose, and possible preemption by
other actor events remain unverified.

For 16.23.841.8428, the portable reader can reconstruct these windows from
ordinary replay packets and a pinned untimed catalog of exact model and clip
bindings. The reviewed compact layouts also include flags 32 and 48. The
original channel uses zero transition duration for those flags. The current
batch supports the linked uncompressed v4 clips as well as the v5 and
compressed v1 formats. Run the batch with `--current-build` to also emit
`champion-animation-catalog.json` and its SHA-256. Give that catalog to the
private package builder for browser-derived playback. Compare the reader with
the original packet receipt and timed cue artifact using
`verify-current-animation-cues.mjs`.

The terrain player points the champion model along the sampled waypoint
direction whenever the replay supplies one. The model keeps the original
axes at positional anchors with no waypoint direction. This is display
facing. Native combat facing, locomotion poses, and particle attachment
transforms use separate inputs.

Use `probe-recorded-movement-provider-update.py` with the original macOS
archive, ROFL, and pinned champion source manifest to reproduce provider
behavior on the reviewed Maokai waypoint pair. The verifier decodes the
original packets and executes their native coordinate expansion. It exercises
the original provider constructor and update under controlled collision,
elapsed-time, and wrapper inputs. The clear controls execute the original
position commit and actor-history writes. Three eligible multi-point controls
reach the native `Run` invocation. Playback activation still requires the
actual frame clock, collision outcome, and animation selection.

### Recorded unmasked ground particles

The reviewed `.8428` Maokai E ground glow uses authored world vertices and
the unmasked quad shader without alpha testing. The renderer applies source
alpha additive blending and clockwise back-face culling. Depth testing,
depth writes, and polygon offset are disabled for this pass.

Run `probe-recorded-detached-quad-expiry.py` with the pinned archive, asset,
creation, and stop receipts. With the full-match creation and stop receipts,
use `--all-ground-glows` and produce separate `--world-ground-quad primary`
and `alternate` outputs. The author verifies both outputs, extracts the
authored texture from the exact installation, and adds the 40 paths to the
existing schema-6 track. Supply the base track with its sibling
`recorded-particles` directory to carry forward its verified resources.

```powershell
bun sandbox/poc/league-spectator/replay/tools/research/author-recorded-world-ground-quad.mjs `
  $installation $textureMipAssembly $primaryReceipt $alternateReceipt $baseTrack $output
```

The signed-out browser proof can follow the reviewed Maokai at `1023.8`,
`1715`, or `2063.7` with
`capture-recorded-particle-visibility.ts` and `unmasked-ground`. It checks
ordinary 1× playback and compares the same fixed frame with and without the
selected draw. Other spell components require their own placement and
material evidence.

### Recorded basic attack inputs

The `.8428` reader recovers the target, requested attack slot, and signed
centisecond offset from the reviewed compact champion opcode 98 and 992
bodies and lane-minion opcode 359 bodies. Opcode 359 also supplies the raw
binary32 X/Z source coordinates from its native movement wrapper. The native
oracle covers the observed opcode 195 bodies and embedded casts. The portable
reader leaves embedded casts out of the basic-attack stream. A
requested slot can be overridden by the native actor. Animation timing also
uses live state. The packet and asset proofs are separate prerequisites for
rendering an attack.

From the monorepo root, use fresh private output paths and an exact archived
macOS client. Use the SHA-256 of the original replay and the prepared terrain
byte maps for verification.

```powershell
$attackTools = "sandbox/poc/league-spectator/replay/tools/research"
bun "$attackTools/verify-recorded-basic-attacks.mjs" $originalRofl $replaySha256 | Set-Content -Encoding utf8 $attackCorpus
Get-Content -Raw $attackCorpus | uv run --offline --with unicorn python "$attackTools/probe-recorded-basic-attacks.py" $macArchive | Set-Content -Encoding utf8 $attackReceipt
bun "$attackTools/verify-recorded-basic-attacks.mjs" $originalRofl $replaySha256 $positionCodecs $attackReceipt
```

Append `--lanes $laneEvidence $laneEvidenceSha256` to both verifier calls to
use independently bound Map11 lane identities and lifetimes. The native
oracle command accepts both packet corpora. The source position is the input
to native movement correction, with final actor placement owned by the movement
controller and the actor update.

Run the `.8428` receiver separately to verify effective slot selection, host
clock scaling, and the next-attack deadline. Its JSON identifies the supplied
character flags, round-robin cursors, slot availability, actor stats, and host
clock controls. It checks both positive and negative packet offsets against
the original stored deadline. Effective selection and animation timing for
recorded actors still need the corresponding live character state.

```powershell
uv run --offline --with unicorn python "$attackTools/probe-recorded-attack-receiver.py" $macArchive | Set-Content -Encoding utf8 $receiverReceipt
```

The asset census reads the equipped skins from the recorded opening and
checks each original character record, spell, graph, and rig. The optional
proofs supply the native default spell names and the animation default for
an absent field. The report identifies direct clips and unresolved graph
selectors. It supplies no playback clocks.

```powershell
$attackDefaultsSha256 = uv run --offline --with unicorn python "$attackTools/probe-exact-attack-defaults.py" $macArchive $attackDefaults
bun "$attackTools/census-recorded-attack-animations.mjs" $installation $originalRofl $championManifest $championManifestSha256 $attackAssetCensus --attack-defaults $attackDefaults $attackDefaultsSha256 --spell-animation-default $macArchive
```

### Verify recorded seek windows

From the repository root, compare the indexed seek reader with a sequential
packet traversal for exact `.3489` and `.8428` recordings. The proof checks
the original headers and payload bytes at each keyframe, between keyframes,
and at the end of the match. It repeats the queries in reverse order and
rejects canceled or out-of-range seeks.

```powershell
bun sandbox/poc/league-spectator/replay/tools/research/prove-recorded-seek-corpus.mjs $originalRofl $replaySha256 .cache/reviewed-seek.json
```

## Recorded terrain fog provider packets

From the monorepo root, use the saved short and long Summoner's Rift ROFLs
under their original `NA1-<game-id>.rofl` filenames and the licensed
16.23.840.6595 macOS executable. Set `$shortRofl`, `$longRofl`, and
`$macExecutable` to those local paths. Use fresh output paths.

```powershell
bun sandbox/poc/league-spectator/replay/tools/extract-exact-fog-provider-packets.mjs `
  $shortRofl $longRofl .cache/exact-fog-provider-packets.json
uv run --offline --with unicorn python sandbox/poc/league-spectator/replay/tools/probe-exact-fog-provider-packets.py `
  $macExecutable .cache/exact-fog-provider-packets.json .cache/exact-fog-provider-receipt.json
```

The extractor pins the replay digests, the build and protocol, and the
packet counts. The oracle pins the envelope extract and x86-64 executable
slice. It runs the exact opcode 1158 and 820 readers and dispatch paths,
requiring complete consumption, and records the registration and post-registration
arguments and the removed provider IDs. The long replay supplies 10,688
registrations and 1,129 removals in stream 1 and 2,788 registrations in stream 2.
The short replay supplies 136 registrations and 11 removals in stream 1
and 84 registrations in stream 2. Both recordings have zero opcode 985
provider position updates.

The native grid producer at `0x221900` consumes the registry that the
opcode 1158 registrar at `0x214960` populates. The oracle supplies controlled
entity lookup and registration ownership to observe dispatch without a live
world. Owner radius modifiers, checkpoint restoration, providers created by
the world, native stencil evaluation against Map11 navgrid data, and final
terrain fog remain open.

### Historical fixed-version controls

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
