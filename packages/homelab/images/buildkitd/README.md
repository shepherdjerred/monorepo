# Patched BuildKit daemon

This image is upstream BuildKit v0.35.1 with one change: when the image
exporter's `rewrite-timestamp` reprocesses a layer, it keeps the result and
reuses it. Every other file is the upstream release image; the patch replaces
only `/usr/bin/buildkitd`, built the way upstream builds it.
`resources/buildkitd.ts` chooses between this image and the upstream catalog
release.

## Why

Application image pushes use `rewrite-timestamp=true` (`docker-bake.hcl`,
`appoutput()`). That option clamps layer file times to `SOURCE_DATE_EPOCH`,
which keeps rebuilt images reproducible.

Upstream does this work again on every export. It decompresses every non-base
layer, rewrites the tar headers and recompresses the result into the content
store. It does so even when the layer was a cache hit and the output is
byte-identical to the previous export. Upstream has a skip check, but it reads
an annotation that cached layer descriptors never carry, and nothing maps a
source blob to its rewritten blob.

## What the patch does

After a conversion commits, the source blob gets two labels:

- a record of the rewritten blob: its digest, size and uncompressed digest;
- a GC content reference to the rewritten blob,
  `containerd.io/gc.ref.content.buildkit.rewritten.<key>`.

`<key>` hashes the normalized converter configuration: the patch version, Go
toolchain, BuildKit revision, epoch, compression type, media type, force and
level.

The next export of the same source blob reuses the record only when:

- the referenced blob exists with the recorded size;
- that blob carries the recorded uncompressed digest and epoch;
- the GC reference is present.

Otherwise the layer is converted as before and the record is replaced. A
rewritten blob that already existed without those labels gets them from the
conversion that finds it. This happens, for example, after the exact-digest
smoke pulls the blob back.

Some layers are never reused:

- layers that may match an immutable base-image diffID;
- formats with finalizer annotations, such as estargz;
- layers recompressed without `rewrite-timestamp`.

Rewriting is deterministic, so a reused blob has the bytes a new conversion
would produce. Image digests, the `application-image-reproducibility.test.ts`
invariants and Delivery artifact identity do not change.

### Lifetime and accounting

containerd's metadata GC follows `containerd.io/gc.ref.content[./]<name>`
labels on content (`core/metadata/gc.go`, `labelGCContentRef`), but only
through non-flat leases. How long a rewritten blob lives depends on how its
source blob's cache record holds that blob:

- **Records whose blob BuildKit produced (`setBlob`).** These also hold the
  blob in the record's non-flat `-variants` lease (`cache/refs.go`
  `linkBlob`). The rewritten blob lives as long as the record and is collected
  with it.
- **Records created only by `GetByBlob`** (pulled or imported layers). These
  hold their blob in a flat lease. GC collects the rewritten blob on its next
  pass, and the following export converts the layer again. That is a missed
  reuse, never a wrong one.

The retained blobs are real disk usage, so the patch counts them. `DiskUsage`
and prune add the sizes of the rewritten blobs that a record's blob and its
compression variants reference. `buildctl du` and the GC policies' usage
thresholds therefore include them. The record's own cached size does not, so a
rewritten blob that a later export adds is counted on the next calculation.

Steady state is one extra rewritten copy for each live exported source blob.
The GC policies bound that copy like any other usage.

## Verification

- **Image build.** The build runs three test suites:
  - the patch's converter tests: reuse, rejection on any configuration change,
    rejection of a missing blob, a size mismatch or a missing GC reference,
    the existing-blob labelling path, and lifetime under flat and `-variants`
    leases;
  - upstream's compression tests;
  - the cache accounting test.
- **Smoke stage.** It prints the daemon version, `v0.35.1+rewrite-reuse.1`.
- **Pin check.** `resources/buildkitd.test.ts` fails if any of these drift
  apart:
  - this Dockerfile's `FROM moby/buildkit` reference;
  - the release tag and commit named in its header;
  - the version string;
  - the version catalog's `moby/buildkit` pin.

  Renovate does not bump `moby/buildkit` in this file.

## Rollback

`resources/buildkitd.ts` with `upstream` renders the version catalog's
`moby/buildkit` image. Rolling back needs no image that the patched daemon
built.

The normal path is a revert through CI. If the daemon cannot build the
pipeline that would publish that revert:

1. Repin the buildkitd Deployment's container to the catalog's upstream
   digest. This is a recorded emergency change.
2. Reconcile it back through the reverted source once CI is healthy.

## Dropping the patch

Drop the patch when a BuildKit release reuses rewritten blobs across exports
in `exporter/containerimage/writer.go` or `util/converter/converter.go`.

1. **Confirm the replacement.** On the upstream daemon, a warm second export of
   an unchanged image must show no rewrite time and the same digest that this
   image produces.
2. **Switch back.** Set `resources/buildkitd.ts` to `upstream` on that release.
3. **Remove the image.** Delete this directory and any catalog, bake and
   Renovate entries for it in the same change.

Labels this patch wrote stay on source blobs after it is dropped. Upstream GC
still honours the `containerd.io/gc.ref.content.buildkit.rewritten.*`
references, so the rewritten blobs remain until their source records are
collected. Upstream accounting does not count them. To reclaim that space
immediately, prune the cache with `buildctl prune --all`. It costs one cold
rebuild; there is no per-label cleanup.

## Upgrading BuildKit while keeping the patch

1. Rebase `rewrite-timestamp-reuse.patch` onto the new tag.
2. Update this Dockerfile in the same change as the catalog's `moby/buildkit`
   pin:
   - the tag and commit header;
   - the fetched commit;
   - the version string;
   - the `FROM` digest.
3. Bump `rewriteReuseVersion` if the patch's own behaviour changes. The Go
   toolchain and BuildKit revision are already part of the key.
