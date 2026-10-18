# The upstream 3.6.0 plugin with GUID-based restore, rotation and expiry sweep.
FROM golang:1.27.2@sha256:5bc7f572bbaa98885a3a1fd9c0aa76b59e3e14e8628bfc316bbfd0c701e4818c AS builder
WORKDIR /src
RUN git init . && git remote add origin https://github.com/openebs/velero-plugin.git \
  && git fetch --depth 1 origin cea57783e3ed887d2b7b0e7bafc436ff26bd9a7b \
  && git checkout --detach FETCH_HEAD
COPY chain.patch /tmp/chain.patch
COPY zfs_chain.go zfs_chain_test.go zfs_gc.go zfs_gc_test.go pkg/clouduploader/
COPY plugin_gc.go plugin_gc_test.go pkg/zfs/plugin/
COPY velero_backups.go pkg/velero/backups.go
RUN git apply --unidiff-zero /tmp/chain.patch
COPY stream.patch /tmp/stream.patch
COPY restore.patch /tmp/restore.patch
COPY stream.go stream_test.go restore_reader.go restore_reader_test.go pkg/clouduploader/
COPY transfer_result.go transfer_result_test.go pkg/zfs/plugin/
RUN git apply /tmp/stream.patch && git apply --unidiff-zero /tmp/restore.patch
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
  go test ./pkg/clouduploader ./pkg/zfs/plugin \
  && CGO_ENABLED=0 go build -o /out/velero-blockstore-openebs ./velero-blockstore-openebs
COPY copy-plugin.go /tmp/copy-plugin.go
RUN CGO_ENABLED=0 go build -o /out/copy-plugin /tmp/copy-plugin.go
FROM builder AS smoke
RUN test -x /out/velero-blockstore-openebs && test -x /out/copy-plugin
FROM scratch AS image
COPY --from=builder /out/ /
# Velero's plugins EmptyDir uses fsGroup 65532 so this init can write as non-root.
USER 65532:65532
ENTRYPOINT ["/copy-plugin"]
LABEL org.opencontainers.image.source="https://github.com/shepherdjerred/monorepo"
