import {
  requireAllPresent,
  requireNonePresent,
} from "./validate-pipeline-lib.ts";

export async function validateCaddySmokeContracts(): Promise<void> {
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
