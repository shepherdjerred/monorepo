# Preserve OpenEBS 2.11.2 and its runtime utilities; change only restore idle time.
FROM golang:1.27.2@sha256:5bc7f572bbaa98885a3a1fd9c0aa76b59e3e14e8628bfc316bbfd0c701e4818c AS builder
WORKDIR /src
RUN git init . && git remote add origin https://github.com/openebs/zfs-localpv.git \
  && git fetch --depth 1 origin 24bbd8942d5fba8897e83a2c69b532c0215157da \
  && git checkout --detach FETCH_HEAD
COPY restore-timeout.patch /tmp/restore-timeout.patch
COPY restore_timeout_test.go pkg/zfs/
RUN git apply /tmp/restore-timeout.patch
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
  go test ./pkg/zfs \
  && CGO_ENABLED=0 go build -mod=readonly \
  -ldflags "-X github.com/openebs/zfs-localpv/v2/pkg/version.GitCommit=24bbd8942d5fba8897e83a2c69b532c0215157da -X github.com/openebs/zfs-localpv/v2/pkg/version.Version=2.11.2 -X github.com/openebs/zfs-localpv/v2/pkg/version.VersionMeta=restore-idle-300s" \
  -o /out/zfs-driver ./cmd

FROM openebs/zfs-driver:2.11.2@sha256:0234692bb4a48b3e70d0bc25f3327ca2b6f1c93d57a066eea755a5c0d94bfb2d AS image
COPY --from=builder /out/zfs-driver /usr/local/bin/zfs-driver
LABEL org.opencontainers.image.source="https://github.com/shepherdjerred/monorepo"

FROM image AS smoke
RUN ["/usr/local/bin/zfs-driver", "--help"]
