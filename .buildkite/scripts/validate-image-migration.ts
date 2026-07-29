import {
  fail,
  requireAllPresent,
  requireNonePresent,
} from "./validate-pipeline-lib.ts";

type SmokePort = {
  readonly image: string;
  readonly port: number;
};

function smokeStage(dockerfile: string, image: string): string {
  const marker = /^FROM .+ AS smoke$/m.exec(dockerfile);
  if (marker?.index === undefined) {
    fail(`${image} Dockerfile has no smoke stage`);
  }
  const remainder = dockerfile.slice(marker.index + marker[0].length);
  const nextStage = remainder.search(/^FROM /m);
  return nextStage === -1 ? remainder : remainder.slice(0, nextStage);
}

export function hclNamedBlock(
  document: string,
  blockType: string,
  name: string,
): string {
  if (!/^[a-z][a-z-]*$/.test(blockType) || name.length === 0) {
    fail(`invalid HCL block selector ${blockType}:${name}`);
  }
  const marker = `${blockType} "${name}"`;
  const markerIndex = document.indexOf(marker);
  if (markerIndex === -1) {
    fail(`docker-bake.hcl has no ${marker}`);
  }
  const openIndex = document.indexOf("{", markerIndex + marker.length);
  if (openIndex === -1) {
    fail(`docker-bake.hcl ${marker} has no body`);
  }

  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = openIndex; index < document.length; index += 1) {
    const character = document.charAt(index);
    if (quoted) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        quoted = false;
      }
      continue;
    }
    switch (character) {
      case '"':
        quoted = true;
        break;
      case "{":
        depth += 1;
        break;
      case "}":
        depth -= 1;
        if (depth === 0) {
          return document.slice(markerIndex, index + 1);
        }
        break;
    }
  }
  fail(`docker-bake.hcl ${marker} has an unclosed body`);
}

export function assertDeterministicBinderyIdentity(
  dockerBake: string,
  dockerfile: string,
): void {
  const binderyTarget = hclNamedBlock(dockerBake, "target", "bindery");
  if (/\b(?:VERSION|GIT_SHA)\b/.test(binderyTarget)) {
    fail("bindery bake target must not consume per-build VERSION or GIT_SHA");
  }
  if (/^ARG (?:VERSION|COMMIT|BUILD_DATE)(?:=|$)/m.test(dockerfile)) {
    fail(
      "bindery Dockerfile must not declare dynamic VERSION, COMMIT, or BUILD_DATE arguments",
    );
  }
  requireAllPresent(
    dockerfile,
    [
      'source_ref="$(printf \'%.12s\' "${BINDERY_SOURCE_REF}")"',
      'patch_ref="$(sha256sum /tmp/0001-gb-author-synthetic.patch | cut -c1-12)"',
      "main.version=sha-${source_ref}-patch-${patch_ref}",
      "main.commit=${BINDERY_SOURCE_REF}",
      "main.date=",
      '"\\"version\\":\\"sha-${source_ref}-patch-${patch_ref}\\""',
      '"\\"commit\\":\\"${BINDERY_SOURCE_REF}\\""',
    ],
    (required) =>
      `bindery deterministic runtime identity is missing contract ${required}`,
  );
}

export function explicitSmokePort(
  dockerfile: string,
  image: string,
  variable: string,
): SmokePort {
  if (!/^[A-Z_]+$/.test(variable)) {
    fail(`invalid smoke port variable ${variable}`);
  }
  const stage = smokeStage(dockerfile, image);
  const exports = stage.matchAll(/\bexport\s+([A-Z_]+)=:?([1-9]\d{0,4});/g);
  const rawPort = exports.find((match) => match[1] === variable)?.[2];
  if (rawPort === undefined) {
    fail(`${image} smoke must export an explicit ${variable}`);
  }
  const port = Number.parseInt(rawPort, 10);
  if (port > 65_535) {
    fail(`${image} smoke port ${rawPort} is outside the TCP port range`);
  }
  return { image, port };
}

export function httpSmokePort(dockerfile: string, image: string): SmokePort {
  const stage = smokeStage(dockerfile, image);
  const rawPort = /http:\/\/127\.0\.0\.1:([1-9]\d{0,4})/.exec(stage)?.[1];
  if (rawPort === undefined) {
    fail(`${image} smoke has no explicit loopback HTTP port`);
  }
  return { image, port: Number.parseInt(rawPort, 10) };
}

export function assertUniqueSmokePorts(ports: readonly SmokePort[]): void {
  const owners = new Map<number, string>();
  for (const { image, port } of ports) {
    const owner = owners.get(port);
    if (owner !== undefined) {
      fail(
        `${image} and ${owner} smoke stages both bind port ${port.toString()} during parallel bake`,
      );
    }
    owners.set(port, image);
  }
}

export async function validateImageMigrationContracts(
  pipeline: string,
  bakeImages: string,
): Promise<void> {
  if (bakeImages.includes("ALWAYS_ON_TARGETS")) {
    fail("bake-images.ts restored the always-on image target workaround");
  }
  requireAllPresent(
    bakeImages,
    [
      '"docker"',
      '"buildx"',
      '"bake"',
      '"--builder"',
      '"ci"',
      "CADDYFILE_SMOKE_PATH",
    ],
    (required) =>
      `bake-images.ts is missing production image contract ${required}`,
  );
  requireNonePresent(
    bakeImages,
    ["CI_BUILDX_", "--target", "image-build-manifest"],
    (forbidden) =>
      `bake-images.ts retained rejected Buildx experiment ${forbidden}`,
  );
  for (const forbidden of ["--load", "DOCKER_HOST", "docker:28-dind"]) {
    if (pipeline.includes(forbidden) || bakeImages.includes(forbidden)) {
      fail(`CI retained forbidden Docker-in-Docker path ${forbidden}`);
    }
  }

  const dockerBake = await Bun.file("docker-bake.hcl").text();
  if (dockerBake.includes('variable "READ_CACHE"')) {
    fail("docker-bake.hcl retained the rejected Buildx experiment cache mode");
  }

  const buildCiImage = await Bun.file(
    ".buildkite/scripts/build-ci-image.ts",
  ).text();
  const buildCiImageCore = await Bun.file(
    ".buildkite/scripts/migration-core.ts",
  ).text();
  const buildCiImageContract = `${buildCiImage}\n${buildCiImageCore}`;
  if (
    !buildCiImageContract.includes(
      "tcp://buildkitd-buildkitd-service.buildkitd.svc.cluster.local:1234",
    ) ||
    !buildCiImageContract.includes('"--builder"') ||
    !buildCiImageContract.includes('"ci"')
  ) {
    fail("build-ci-image.ts must use the remote production BuildKit builder");
  }

  const caddyCheck = await Bun.file(
    "packages/homelab/src/cdk8s/scripts/check-caddyfile.ts",
  ).text();
  requireNonePresent(
    caddyCheck,
    ['"docker"', "caddy-s3proxy:dev", "docker buildx", "imageExists"],
    (hiddenBuild) =>
      `check-caddyfile.ts restored hidden build path ${hiddenBuild}`,
  );

  const caddyDockerfile = await Bun.file(
    "packages/homelab/images/caddy-s3proxy/Dockerfile",
  ).text();
  requireAllPresent(
    caddyDockerfile,
    [
      "FROM runtime AS smoke",
      "--mount=type=secret,id=caddyfile",
      "caddy adapt --config /run/secrets/caddyfile --adapter caddyfile",
    ],
    (required) => `Caddy in-image smoke is missing contract ${required}`,
  );

  const [binderyDockerfile, shelfbridgeDockerfile, redlibDockerfile] =
    await Promise.all([
      Bun.file("packages/homelab/images/bindery/Dockerfile").text(),
      Bun.file("packages/homelab/images/shelfbridge/Dockerfile").text(),
      Bun.file("packages/homelab/images/redlib/Dockerfile").text(),
    ]);
  assertDeterministicBinderyIdentity(dockerBake, binderyDockerfile);
  const binderyPort = explicitSmokePort(
    binderyDockerfile,
    "bindery",
    "BINDERY_PORT",
  );
  const shelfbridgePort = explicitSmokePort(
    shelfbridgeDockerfile,
    "shelfbridge",
    "LISTEN_ADDR",
  );
  requireAllPresent(
    smokeStage(shelfbridgeDockerfile, "shelfbridge"),
    [
      `http://127.0.0.1:${shelfbridgePort.port.toString()}/torznab/api`,
      `http://127.0.0.1:${shelfbridgePort.port.toString()}/health`,
    ],
    (required) =>
      `shelfbridge smoke listener and probe disagree: missing ${required}`,
  );
  assertUniqueSmokePorts([
    binderyPort,
    shelfbridgePort,
    httpSmokePort(redlibDockerfile, "redlib"),
  ]);
}
