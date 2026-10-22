# syntax=docker/dockerfile:1-labs@sha256:ad43eec41369d9ef94412c0d1eb3203d12218d01da225afc92a3aeba3a0e7796
FROM oven/bun:1.4.2@sha256:9114c058aeae42162ee16dd5084b95fe9473970bb6bcb5b232ab1630f0546895 AS base
WORKDIR /app

FROM base AS native-tools
# renovate: datasource=github-releases depName=kubernetes/kubectl
ARG KUBECTL_VERSION=v1.37.1
ARG TARGETARCH
# Bun's HTTPS client and SHA-256 implementation avoid extra unpinned build tools.
RUN bun -e '\
    const arch = process.env.TARGETARCH; \
    if (!["amd64", "arm64"].includes(arch)) throw new Error("Unsupported kubectl architecture"); \
    const base = "https://dl.k8s.io/release/" + process.env.KUBECTL_VERSION + "/bin/linux/" + arch + "/kubectl"; \
    const [binary, checksum] = await Promise.all([fetch(base), fetch(base + ".sha256")]); \
    if (!binary.ok || !checksum.ok) throw new Error("Pinned kubectl download failed"); \
    const bytes = new Uint8Array(await binary.arrayBuffer()); \
    const expected = (await checksum.text()).trim(); \
    if (!/^[a-f0-9]{64}$/.test(expected) || new Bun.CryptoHasher("sha256").update(bytes).digest("hex") !== expected) throw new Error("Pinned kubectl checksum mismatch"); \
    await Bun.write("/usr/local/bin/kubectl", bytes); \
    await (await import("node:fs/promises")).chmod("/usr/local/bin/kubectl", 0o755); \
    ' && kubectl version --client

# ── manifests: only the install closure's workspace manifests ───────────────
# Every manifest reaches this cheap stage; installs copy only its output, so an
# edit to a package outside the closure keeps their cache keys and layers.
FROM base AS manifests
COPY --parents \
  package.json scripts/package.json \
  packages/*/package.json packages/*/packages/*/package.json \
  packages/docs/wiki/package.json \
  packages/homelab/src/cdk8s/package.json \
  packages/homelab/src/helm-types/package.json \
  /workspace/
COPY --parents \
  ci/scripts/images/workspace-manifests.ts \
  ci/scripts/selectors/select-image-targets-workspaces.ts \
  ci/scripts/selectors/select-image-targets-lockfile.ts \
  /tools/
RUN bun /tools/ci/scripts/images/workspace-manifests.ts /workspace /closure \
  '@shepherdjerred/delivery'

FROM base AS deps
COPY --parents bun.lock bunfig.toml patches/ ./
COPY --from=manifests /closure/ ./
RUN bun install --frozen-lockfile --filter '@shepherdjerred/delivery'

FROM deps AS build
COPY --parents tsconfig.base.json packages/delivery packages/config packages/feature-flags packages/ops-model packages/ops-clients packages/version-catalog packages/eslint-config ./
RUN cd packages/delivery && bun run generate && bun run build

FROM base AS prod-deps
COPY --parents bun.lock bunfig.toml patches/ ./
COPY --from=manifests /closure/ ./
RUN bun install --frozen-lockfile --production --filter '@shepherdjerred/delivery'
# Bun can skip the .bin links between dependency-cycle members on a cold
# install; complete them so the production tree reproduces.
COPY ci/scripts/images/complete-bin-links.ts /tools/
RUN bun /tools/complete-bin-links.ts node_modules/.bun

FROM base AS runtime
COPY --from=native-tools /usr/local/bin/kubectl /usr/local/bin/kubectl
COPY --from=prod-deps --exclude=package.json --exclude=bun.lock --exclude=bunfig.toml --exclude=patches /app/ /app/
COPY --from=build --exclude=node_modules /app/packages/delivery /app/packages/delivery
COPY --parents packages/config packages/feature-flags packages/ops-model packages/ops-clients packages/version-catalog ./
# Prisma's CLI records per-run state under $HOME; keep it out of the layer.
RUN cd packages/delivery && CHECKPOINT_DISABLE=1 bunx --no-install --trust prisma generate \
 && rm -rf "$HOME/.cache/checkpoint-nodejs" "$HOME/.config/prisma-nodejs"
WORKDIR /app/packages/delivery
ARG VERSION=dev
ARG GIT_SHA=unknown
ENV VERSION=${VERSION} GIT_SHA=${GIT_SHA}
ENV NODE_ENV=production HOME=/tmp
LABEL org.opencontainers.image.source="https://github.com/shepherdjerred/monorepo"
EXPOSE 7353
USER 1000:1000
CMD ["bun", "src/server/index.ts"]

FROM runtime AS smoke
COPY ci/scripts/images/smoke-app-in-image.ts /app/ci/scripts/images/smoke-app-in-image.ts
COPY ci/scripts/images/smoke-app-configs.ts /app/ci/scripts/images/smoke-app-configs.ts
ARG SMOKE_TARGET=delivery
ENV CI_IMAGE_SMOKE_TARGET=${SMOKE_TARGET}
RUN bunx --no-install prisma --version && bun /app/ci/scripts/images/smoke-app-in-image.ts

FROM runtime AS image
