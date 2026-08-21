import { describe, expect, test } from "vitest";
import { assertMonorepoSourceLabel } from "./docker-source-label.ts";

import {
  applicationSmokePort,
  assertWikiManifestInDockerContext,
  assertWorkspaceInstallContexts,
  assertUniqueSmokePorts,
  explicitWorkspaceManifests,
  explicitSmokePort,
  httpSmokePort,
  resolvedBakeTarget,
} from "./validate-image-migration.ts";

describe("Docker workspace manifest contexts", () => {
  const explicitManifests = explicitWorkspaceManifests([
    "packages/birmel",
    "packages/discord-plays-pokemon/packages/backend",
    "packages/docs/wiki",
    "packages/homelab/src/cdk8s",
    "scripts",
  ]);

  test("derives only manifests outside the common workspace globs", () => {
    expect(explicitManifests).toEqual([
      "packages/docs/wiki/package.json",
      "packages/homelab/src/cdk8s/package.json",
      "scripts/package.json",
    ]);
  });

  test("accepts every frozen install context when all manifests are copied", () => {
    const manifests = explicitManifests.join(" ");
    const dockerfile = `
FROM base AS deps
COPY --parents package.json ${manifests} ./
RUN bun install --frozen-lockfile --filter app
FROM base AS prod-deps
COPY --parents package.json ${manifests} ./
RUN bun install --frozen-lockfile --production --filter app
`;

    expect(() => {
      assertWorkspaceInstallContexts(dockerfile, "app", explicitManifests);
    }).not.toThrow();
  });

  test("reports every manifest missing from a specific install stage", () => {
    const dockerfile = `
FROM base AS deps
COPY --parents package.json packages/docs/wiki/package.json ./
RUN bun install --frozen-lockfile --filter app
`;

    expect(() => {
      assertWorkspaceInstallContexts(dockerfile, "app", explicitManifests);
    }).toThrow(
      [
        "app deps frozen install is missing workspace manifests:",
        "- packages/homelab/src/cdk8s/package.json",
        "- scripts/package.json",
      ].join("\n"),
    );
  });

  test("requires a narrow wiki manifest exception in the Docker context", () => {
    expect(() => {
      assertWikiManifestInDockerContext(`
packages/docs/*
!packages/docs/wiki
packages/docs/wiki/*
!packages/docs/wiki/package.json
`);
    }).not.toThrow();
    expect(() => {
      assertWikiManifestInDockerContext("packages/docs");
    }).toThrow(
      ".dockerignore is missing wiki workspace manifest context rule packages/docs/*",
    );
  });
});

describe("GHCR package provenance", () => {
  test("uses the Dockerfile and stage from resolved Bake output", () => {
    expect(
      resolvedBakeTarget(
        {
          target: {
            example: {
              dockerfile: "packages/example/Dockerfile",
              target: "release",
            },
          },
        },
        "example",
      ),
    ).toEqual({
      dockerfilePath: "packages/example/Dockerfile",
      publishedStage: "release",
    });
  });

  test("requires the published image stage to link its source repository", () => {
    expect(() =>
      assertMonorepoSourceLabel(
        'FROM runtime AS image\nLABEL org.opencontainers.image.source="https://github.com/shepherdjerred/monorepo"',
        "example",
        "image",
      ),
    ).not.toThrow();
    expect(() =>
      assertMonorepoSourceLabel("FROM runtime AS image", "example", "image"),
    ).toThrow(
      "example published image stage must link its GHCR package to the public monorepo",
    );
    expect(() =>
      assertMonorepoSourceLabel(
        [
          "FROM runtime AS image",
          'LABEL org.opencontainers.image.source="https://github.com/shepherdjerred/monorepo" description="<<EOF"',
          'LABEL org.opencontainers.image.source="https://github.com/somewhere/else"',
        ].join("\n"),
        "example",
        "image",
      ),
    ).toThrow(
      "example published image stage must link its GHCR package to the public monorepo",
    );
    expect(() =>
      assertMonorepoSourceLabel(
        [
          "# escape=`",
          "FROM runtime AS image",
          String.raw`LABEL org.opencontainers.image.source="https://github.com/shepherdjerred/monorepo" vendor=\ org.opencontainers.image.source="https://github.com/somewhere/else"`,
        ].join("\n"),
        "example",
        "image",
      ),
    ).toThrow(
      "example published image stage must link its GHCR package to the public monorepo",
    );
    expect(() =>
      assertMonorepoSourceLabel(
        'FROM --platform=$BUILDPLATFORM runtime AS image\nLABEL org.opencontainers.image.source="https://github.com/shepherdjerred/monorepo"',
        "example",
        "image",
      ),
    ).not.toThrow();
    expect(() =>
      assertMonorepoSourceLabel(
        [
          "FROM runtime AS image",
          "FROM --platform=$BUILDPLATFORM runtime AS helper",
          'LABEL org.opencontainers.image.source="https://github.com/shepherdjerred/monorepo"',
        ].join("\n"),
        "example",
        "image",
      ),
    ).toThrow(
      "example published image stage must link its GHCR package to the public monorepo",
    );
    expect(() =>
      assertMonorepoSourceLabel(
        [
          "# syntax=docker/dockerfile:1",
          "# escape=`",
          "FROM runtime AS image",
          'LABEL org.opencontainers.image.source="https://github.com/shepherdjerred/monorepo" `',
          '  org.opencontainers.image.source="https://github.com/somewhere/else"',
        ].join("\n"),
        "example",
        "image",
      ),
    ).toThrow(
      "example published image stage must link its GHCR package to the public monorepo",
    );
    expect(() =>
      assertMonorepoSourceLabel(
        'FROM base AS runtime\nLABEL org.opencontainers.image.source="https://github.com/shepherdjerred/monorepo"\nFROM runtime AS image',
        "example",
        "image",
      ),
    ).not.toThrow();
    expect(() =>
      assertMonorepoSourceLabel(
        'FROM runtime AS image\nLABEL vendor=example org.opencontainers.image.source="https://github.com/shepherdjerred/monorepo"',
        "example",
        "image",
      ),
    ).not.toThrow();
    expect(() =>
      assertMonorepoSourceLabel(
        'FROM runtime AS image\nLABEL description="mentions org.opencontainers.image.source=https://github.com/shepherdjerred/monorepo"',
        "example",
        "image",
      ),
    ).toThrow(
      "example published image stage must link its GHCR package to the public monorepo",
    );
    expect(() =>
      assertMonorepoSourceLabel(
        'FROM runtime AS image\nLABEL org.opencontainers.image.source="https://github.com/shepherdjerred/monorepo" vendor=example org.opencontainers.image.source="https://github.com/somewhere/else"',
        "example",
        "image",
      ),
    ).toThrow(
      "example published image stage must link its GHCR package to the public monorepo",
    );
    expect(() =>
      assertMonorepoSourceLabel(
        'FROM runtime AS image\nLABEL org.opencontainers.image.source="https://github.com/somewhere/else"',
        "example",
        "image",
      ),
    ).toThrow(
      "example published image stage must link its GHCR package to the public monorepo",
    );
    expect(() =>
      assertMonorepoSourceLabel(
        [
          "FROM base AS runtime",
          'LABEL org.opencontainers.image.source="https://github.com/shepherdjerred/monorepo"',
          "FROM runtime AS image",
          `LABEL vendor=example ${String.fromCodePoint(92)}`,
          '  org.opencontainers.image.source="https://github.com/somewhere/else"',
        ].join("\n"),
        "example",
        "image",
      ),
    ).toThrow(
      "example published image stage must link its GHCR package to the public monorepo",
    );
    expect(() =>
      assertMonorepoSourceLabel(
        'FROM build AS builder\nLABEL org.opencontainers.image.source="https://github.com/shepherdjerred/monorepo"\nFROM runtime AS image',
        "example",
        "image",
      ),
    ).toThrow(
      "example published image stage must link its GHCR package to the public monorepo",
    );
    expect(() =>
      assertMonorepoSourceLabel(
        'FROM runtime AS image\n# LABEL org.opencontainers.image.source="https://github.com/shepherdjerred/monorepo"',
        "example",
        "image",
      ),
    ).toThrow(
      "example published image stage must link its GHCR package to the public monorepo",
    );
  });
});

describe("GHCR Docker instruction parsing", () => {
  test("applies inherited ONBUILD source-label triggers", () => {
    expect(() =>
      assertMonorepoSourceLabel(
        [
          "FROM runtime AS base",
          'LABEL org.opencontainers.image.source="https://github.com/shepherdjerred/monorepo"',
          'ONBUILD LABEL org.opencontainers.image.source="https://github.com/somewhere/else"',
          "FROM base AS image",
        ].join("\n"),
        "example",
        "image",
      ),
    ).toThrow(
      "example published image stage must link its GHCR package to the public monorepo",
    );
    expect(() =>
      assertMonorepoSourceLabel(
        [
          "FROM runtime AS base",
          'ONBUILD LABEL org.opencontainers.image.source="https://github.com/shepherdjerred/monorepo"',
          "FROM base AS image",
        ].join("\n"),
        "example",
        "image",
      ),
    ).not.toThrow();
  });

  test("defers chained ONBUILD source-label triggers by generation", () => {
    const chainedOverride = [
      "# syntax=docker/dockerfile:1.11",
      "FROM runtime AS base",
      'LABEL org.opencontainers.image.source="https://github.com/shepherdjerred/monorepo"',
      'ONBUILD ONBUILD LABEL org.opencontainers.image.source="https://github.com/somewhere/else"',
      "FROM base AS child",
      "FROM child AS image",
    ].join("\n");

    expect(() =>
      assertMonorepoSourceLabel(chainedOverride, "example", "child"),
    ).not.toThrow();
    expect(() =>
      assertMonorepoSourceLabel(chainedOverride, "example", "image"),
    ).toThrow(
      "example published image stage must link its GHCR package to the public monorepo",
    );
    expect(() =>
      assertMonorepoSourceLabel(
        [
          "# syntax=docker/dockerfile:1.11",
          "FROM runtime AS base",
          'ONBUILD ONBUILD LABEL org.opencontainers.image.source="https://github.com/shepherdjerred/monorepo"',
          "FROM base AS child",
          "FROM child AS image",
        ].join("\n"),
        "example",
        "image",
      ),
    ).not.toThrow();
  });

  test("ignores heredoc bodies in chained ONBUILD instructions", () => {
    expect(() =>
      assertMonorepoSourceLabel(
        [
          "# syntax=docker/dockerfile:1.11",
          "FROM runtime AS base",
          "ONBUILD ONBUILD COPY <<EOF /tmp/template",
          'LABEL org.opencontainers.image.source="https://github.com/shepherdjerred/monorepo"',
          "EOF",
          "FROM base AS child",
          "FROM child AS image",
        ].join("\n"),
        "example",
        "image",
      ),
    ).toThrow(
      "example published image stage must link its GHCR package to the public monorepo",
    );
  });

  test("ignores heredoc bodies until their exact delimiters", () => {
    expect(() =>
      assertMonorepoSourceLabel(
        [
          "FROM runtime AS image",
          "COPY <<EOF /tmp/template",
          'LABEL org.opencontainers.image.source="https://github.com/shepherdjerred/monorepo"',
          "EOF",
        ].join("\n"),
        "example",
        "image",
      ),
    ).toThrow(
      "example published image stage must link its GHCR package to the public monorepo",
    );
    expect(() =>
      assertMonorepoSourceLabel(
        [
          "FROM runtime AS image",
          "RUN <<-'EOF'",
          "payload",
          "\tEOF",
          'LABEL org.opencontainers.image.source="https://github.com/shepherdjerred/monorepo"',
        ].join("\n"),
        "example",
        "image",
      ),
    ).not.toThrow();
  });

  test("recognizes non-space instruction separators", () => {
    expect(() =>
      assertMonorepoSourceLabel(
        [
          "FROM runtime AS image",
          'LABEL org.opencontainers.image.source="https://github.com/shepherdjerred/monorepo"',
          'LABEL\torg.opencontainers.image.source="https://github.com/somewhere/else"',
        ].join("\n"),
        "example",
        "image",
      ),
    ).toThrow(
      "example published image stage must link its GHCR package to the public monorepo",
    );
  });

  test("does not treat LABEL values as heredocs", () => {
    expect(() =>
      assertMonorepoSourceLabel(
        [
          "FROM runtime AS image",
          'LABEL org.opencontainers.image.source="https://github.com/shepherdjerred/monorepo"',
          "LABEL description=<<NEVER",
          'LABEL org.opencontainers.image.source="https://github.com/somewhere/else"',
        ].join("\n"),
        "example",
        "image",
      ),
    ).toThrow(
      "example published image stage must link its GHCR package to the public monorepo",
    );
  });

  test("ignores comments inside continued instructions", () => {
    expect(() =>
      assertMonorepoSourceLabel(
        [
          "FROM runtime AS image",
          'LABEL org.opencontainers.image.source="https://github.com/shepherdjerred/monorepo"',
          `LABEL vendor=example ${String.fromCodePoint(92)}`,
          "# Docker removes this comment before joining the instruction",
          '  org.opencontainers.image.source="https://github.com/somewhere/else"',
        ].join("\n"),
        "example",
        "image",
      ),
    ).toThrow(
      "example published image stage must link its GHCR package to the public monorepo",
    );
  });
});

describe("parallel image smoke ports", () => {
  test("extracts application smoke environment ports", () => {
    const source = `
  "tasknotes-server": {
    env: { PORT: "18789" },
  },
  "other": {
    env: {},
  },
`;
    expect(applicationSmokePort(source, "tasknotes-server")).toEqual({
      image: "tasknotes-server",
      port: 18_789,
    });
  });

  test("extracts exported listener ports from the smoke stage only", () => {
    const dockerfile = `
FROM runtime AS release
ENV APP_PORT=8787
FROM release AS smoke
RUN export APP_PORT=:18787; app
FROM release AS image
`;

    expect(explicitSmokePort(dockerfile, "app", "APP_PORT")).toEqual({
      image: "app",
      port: 18_787,
    });
  });

  test("extracts a loopback probe port", () => {
    const dockerfile = `
FROM runtime AS smoke
RUN app & wget http://127.0.0.1:18080/health
FROM runtime AS image
`;

    expect(httpSmokePort(dockerfile, "app")).toEqual({
      image: "app",
      port: 18_080,
    });
  });

  test("rejects implicit listener ports", () => {
    const dockerfile = `
FROM runtime AS smoke
RUN app
FROM runtime AS image
`;

    expect(() => explicitSmokePort(dockerfile, "app", "APP_PORT")).toThrow(
      "app smoke must export an explicit APP_PORT",
    );
  });

  test("rejects duplicate ports across concurrently baked smoke stages", () => {
    expect(() =>
      assertUniqueSmokePorts([
        { image: "redlib", port: 8787 },
        { image: "trmnl-dashboard", port: 8787 },
      ]),
    ).toThrow(
      "trmnl-dashboard and redlib smoke stages both bind port 8787 during parallel bake",
    );
  });
});
