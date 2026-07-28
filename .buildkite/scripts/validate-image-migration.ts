import {
  fail,
  requireAllPresent,
  requireNonePresent,
} from "./validate-pipeline-lib.ts";

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
}
