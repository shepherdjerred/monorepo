# Patched BuildKit daemon

This image is upstream BuildKit v0.35.1 with one change. When the image
exporter's `rewrite-timestamp` reprocesses a layer, it keeps the result and
reuses it. Every other file in the image is the upstream release image. The
patch replaces only `/usr/bin/buildkitd`, built the way upstream builds it.

Liskov does not run this image yet. `resources/buildkitd.ts` defaults to the
upstream catalog release. The `rewrite-reuse` choice cannot render until the
steps under "Enabling" exist.

## Why

Every application image push uses `rewrite-timestamp=true` (`docker-bake.hcl`,
`appoutput()`), so layer file times are clamped to `SOURCE_DATE_EPOCH`. That
clamping is what makes rebuilt images reproducible.

Upstream v0.35.1 does this work again on every export:

- It decompresses every non-base layer.
- It rewrites the tar headers.
- It recompresses the result into the content store, even when the layer was
  a cache hit and the result is byte-identical to the previous push.

The cost shows up in two places:

- The converter's skip check reads an annotation that cached layer descriptors
  never carry.
- Nothing maps a source blob to its rewritten blob.

On 2026-11-27, the 24 hours of main `images` runs re-gzipped 263 GB of layers.
About 214 GB of that was layers whose rewritten form already existed. Another
22 GB was exact-digest smoke builds pulling those blobs back from Docker Hub,
because the rewritten blobs had already been garbage-collected.

## What the patch does

After a conversion commits, the patch labels the source blob with two things:

- A record of the rewritten blob: digest, size and uncompressed digest.
- A `containerd.io/gc.ref.content.*` reference to it.

Both labels are keyed by a hash of the normalized converter configuration: the
patch version, epoch, compression type, media type, force and level.

The next export of the same source blob reuses the record only when all of
these hold:

- The referenced blob exists with the recorded size.
- It carries the recorded uncompressed digest and epoch.
- The GC reference is present.

Otherwise the layer is converted as before, and the record is replaced.

Some conversions are never reused:

- Layers that may match an immutable base-image diffID.
- Formats with finalizer annotations, such as estargz.
- Plain recompression without `rewrite-timestamp`.

Rewriting is deterministic, so a reused blob has the same bytes a new
conversion would produce. Image digests, the
`application-image-reproducibility.test.ts` invariants and Delivery artifact
identity therefore do not change.

containerd's metadata GC follows `containerd.io/gc.ref.content[./]<name>`
labels on content (`core/metadata/gc.go`, `labelGCContentRef`). The rewritten
blob therefore lives exactly as long as its source blob, and both become
collectable together. The unit test `TestRewrittenBlobLifetimeFollowsSourceBlob`
proves it against containerd's metadata database.

## Verification

- **Build-time tests.** The image build runs the patch's converter tests and
  upstream's compression tests. They cover reuse, rejection on any config
  change, rejection of a missing or mismatched blob, rejection of a record
  without its GC reference, and GC lifetime.
- **Smoke stage.** It prints the daemon version, `v0.35.1+rewrite-reuse.1`.

## Enabling

Each step is its own reviewed change. Do them only after the patched daemon is
approved:

1. Register the image.
   - Add `buildkitd` to `packages/version-catalog/src/image-registry.json`.
   - Run `bun run --cwd packages/homelab-cdktn synth` for the Docker Hub
     repository and tokens.
2. Build it in CI.
   - Add an infra target and infra group entry in `docker-bake.hcl`, with
     context `packages/homelab/images/buildkitd`.
   - Add it to `INFRASTRUCTURE_IMAGE_TARGETS` in
     `ci/scripts/images/image-targets.ts` and to the selector prefixes.
3. Give the image an owner.
   - List it under the CI service's `images` in `packages/ops-model/services.json`.
   - Add the matching component in `catalog-document.json`, so Delivery
     qualifies and selects it.
4. Pass `{ image: "rewrite-reuse" }` in `cdk8s-charts/platform/buildkitd.ts`
   and release through the normal Delivery path.
5. Accept it live.
   - A warm `images` run shows `rewriting layers … 0.0s done` for cached layers.
   - Manifest digests match the upstream daemon's output for the same inputs.
   - The buildkitd dataset's `node_zfs_zpool_dataset_nwritten` drops by the
     rewrite share.

## Dropping the patch

Drop it when upstream ships an equivalent: a BuildKit release whose
`exporter/containerimage/writer.go` or `util/converter/converter.go` reuses
rewritten blobs across exports.

1. Confirm the equivalent:
   - A warm second export of an unchanged image on the upstream daemon shows
     no rewrite time.
   - The digest is identical to this image's output.
2. Switch `resources/buildkitd.ts` back to `upstream`, and update
   `moby/buildkit` in the version catalog to that release.
3. Delete this directory, and reverse steps 1–3 of "Enabling" in the same
   change.

Upgrading BuildKit while keeping the patch is a different change:

- Rebase `rewrite-timestamp-reuse.patch` onto the new tag.
- Update the commit, image digest and version string in `Dockerfile`.
- Bump `rewriteReuseVersion` if the rewrite or compression output can differ.
