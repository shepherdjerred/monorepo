import { describe, expect, test } from "bun:test";

import {
  applicationSmokePort,
  assertDeterministicBinderyIdentity,
  assertWikiManifestInDockerContext,
  assertWorkspaceInstallContexts,
  assertUniqueSmokePorts,
  explicitWorkspaceManifests,
  explicitSmokePort,
  hclNamedBlock,
  httpSmokePort,
} from "./validate-image-migration.ts";

const deterministicBinderyDockerfile = `
ARG BINDERY_SOURCE_REF=aaaaaaaaaaaaaaaa
FROM source AS builder
ARG BINDERY_SOURCE_REF
RUN source_ref="$(printf '%.12s' "\${BINDERY_SOURCE_REF}")" \\
  && patch_ref="$(sha256sum /tmp/0001-gb-author-synthetic.patch | cut -c1-12)" \\
  && go build -ldflags="-X main.version=sha-\${source_ref}-patch-\${patch_ref} -X main.commit=\${BINDERY_SOURCE_REF} -X main.date="
FROM source AS smoke
RUN source_ref="$(printf '%.12s' "\${BINDERY_SOURCE_REF}")"; \\
  patch_ref="$(sha256sum /tmp/0001-gb-author-synthetic.patch | cut -c1-12)"; \\
  grep -F "\\"version\\":\\"sha-\${source_ref}-patch-\${patch_ref}\\"" /tmp/bindery-smoke.log; \\
  grep -F "\\"commit\\":\\"\${BINDERY_SOURCE_REF}\\"" /tmp/bindery-smoke.log
`;

const deterministicBinderyBake = `
target "bindery" {
  context = "packages/homelab/images/bindery"
  args = {
    SAFE_VALUE = "brace { inside a quoted value }"
  }
}

target "other" {
  args = {
    VERSION = VERSION
  }
}
`;

describe("deterministic Bindery identity", () => {
  test("extracts the complete named HCL block with nested and quoted braces", () => {
    expect(hclNamedBlock(deterministicBinderyBake, "target", "bindery")).toBe(
      `target "bindery" {
  context = "packages/homelab/images/bindery"
  args = {
    SAFE_VALUE = "brace { inside a quoted value }"
  }
}`,
    );
  });

  test("accepts source-plus-patch runtime identity", () => {
    expect(() =>
      assertDeterministicBinderyIdentity(
        deterministicBinderyBake,
        deterministicBinderyDockerfile,
      ),
    ).not.toThrow();
  });

  test("rejects per-build Bake identity", () => {
    const dynamicBake = deterministicBinderyBake.replace(
      'SAFE_VALUE = "brace { inside a quoted value }"',
      "COMMIT = GIT_SHA",
    );
    expect(() =>
      assertDeterministicBinderyIdentity(
        dynamicBake,
        deterministicBinderyDockerfile,
      ),
    ).toThrow(
      "bindery bake target must not consume per-build VERSION or GIT_SHA",
    );
  });

  test("rejects dynamic linker arguments in the Dockerfile", () => {
    expect(() =>
      assertDeterministicBinderyIdentity(
        deterministicBinderyBake,
        `${deterministicBinderyDockerfile}\nARG BUILD_DATE=unknown`,
      ),
    ).toThrow(
      "bindery Dockerfile must not declare dynamic VERSION, COMMIT, or BUILD_DATE arguments",
    );
  });
});

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
        { image: "bindery", port: 8787 },
        { image: "shelfbridge", port: 8787 },
      ]),
    ).toThrow(
      "shelfbridge and bindery smoke stages both bind port 8787 during parallel bake",
    );
  });
});
