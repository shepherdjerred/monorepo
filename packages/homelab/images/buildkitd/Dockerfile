# Preserve upstream BuildKit v0.35.1 and its bundled runtime; change only how
# the image exporter's rewrite-timestamp converter reuses rewritten layers.
# moby/buildkit v0.35.1 is commit 412cc86ad3c4252b82e929f9b1b1ad167376ded8.
# The release tag, this commit, the version string and the FROM digest below
# move together (buildkitd.test.ts checks them against the version catalog).
FROM golang:1.27.4@sha256:205c7636d74e0ffbe3d007162df7d74f859f5a8c8322dfb9f907977686c126cf AS builder
WORKDIR /src
RUN git init . && git remote add origin https://github.com/moby/buildkit.git \
  && git fetch --depth 1 origin 412cc86ad3c4252b82e929f9b1b1ad167376ded8 \
  && git checkout --detach FETCH_HEAD
COPY rewrite-timestamp-reuse.patch /tmp/rewrite-timestamp-reuse.patch
RUN git apply /tmp/rewrite-timestamp-reuse.patch
# Upstream's static buildkitd build (Dockerfile `buildkitd` stage at
# v0.35.1): CGO off, vendored modules, the same tags. Build metadata marks the
# patch without changing semver precedence for clients that gate on version.
RUN --mount=type=cache,target=/root/.cache/go-build \
  go test -mod=vendor ./util/converter/ ./util/compression/ \
  && go test -mod=vendor ./cache/ -run 'TestDiskUsageCountsRetainedRewrittenBlobs' \
  && CGO_ENABLED=0 go build -mod=vendor \
  -ldflags "-X github.com/moby/buildkit/version.Version=v0.35.1+rewrite-reuse.1 -X github.com/moby/buildkit/version.Revision=412cc86ad3c4252b82e929f9b1b1ad167376ded8 -X github.com/moby/buildkit/version.Package=github.com/moby/buildkit -extldflags '-static'" \
  -tags "osusergo netgo static_build seccomp grpcnotrace" \
  -o /out/buildkitd ./cmd/buildkitd

FROM moby/buildkit:v0.35.1@sha256:baf6138eb8c37644800c7c913fba051e840ebb9ba13eaf92d92ef9a1712d0b4c AS image
COPY --from=builder /out/buildkitd /usr/bin/buildkitd
LABEL org.opencontainers.image.source="https://github.com/shepherdjerred/monorepo"

FROM image AS smoke
RUN ["/usr/bin/buildkitd", "--version"]
