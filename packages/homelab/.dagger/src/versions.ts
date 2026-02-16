const versions = {
  // Git repositories (pinned to specific commits for supply chain security)
  // renovate: datasource=github-releases packageName=openclaw/openclaw
  openclawCommit: "476f367cf16081acd144048ee61198e58d15df21",

  // Dagger CI/CD Docker Images
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  alpine: "3.23.2@sha256:865b95f46d98cf867a156fe4a135ad3fe50d2056aa3f25ed31662dff6da4eb62",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  "alpine/helm": "4.1.0@sha256:905a068da43146a87a06c9c6f7f39cdb66a3cd0973dfc29607784f7172d8d171",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  "oven/bun": "1.3.6@sha256:f20d9cf365ab35529384f1717687c739c92e6f39157a35a95ef06f4049a10e4a",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  ubuntu: "noble@sha256:cd1dba651b3080c3686ecf4e3c4220f026b521fb76978881737d24f200828b2b",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  "curlimages/curl": "8.18.0@sha256:d94d07ba9e7d6de898b6d96c1a072f6f8266c687af78a74f380087a0addf5d17",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=semver
  caddy: "2.10.2@sha256:f20f80e1fb627294fb84b8515b7593aff8018c840f1396dc942a50ed0c2db648",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  "alpine/kubectl": "1.35.0@sha256:e7e078c7bb25012141e5957d500834b2a5b266d6de20ecfa862b30d8a892fc7e",
  // renovate: datasource=github-releases versioning=semver
  "stackrox/kube-linter": "v0.8.1",
  // renovate: datasource=python-version versioning=semver
  python: "3.14.2",
  // renovate: datasource=node-version versioning=semver
  node: "24.13.0",
  // this is empty because we have to perform some string manipulation below
  // not managed by renovate
  bun: "",
  // this is empty because we have to perform some string manipulation below
  // not managed by renovate
  helm: "",
};

const bunVersion = versions["oven/bun"].split("@")[0];
if (bunVersion === undefined) throw new Error("Failed to parse bun version");
versions.bun = bunVersion;

const helmVersion = versions["alpine/helm"].split("@")[0];
if (helmVersion === undefined) throw new Error("Failed to parse helm version");
versions.helm = helmVersion;

// Extract caddy version without digest for use with variant tags (-alpine, -builder-alpine)
// The base caddy digest doesn't apply to variants which have different content
const parsedCaddyVersion = versions.caddy.split("@")[0];
if (parsedCaddyVersion === undefined) throw new Error("Failed to parse caddy version");
const caddyVersionOnly: string = parsedCaddyVersion;

export default versions;

export { caddyVersionOnly };
