/**
 * Centralized container image versions with Renovate annotations for automatic updates.
 *
 * ALL version constants for the Dagger CI/CD pipeline live here.
 * Per-package files import from this module instead of defining their own constants.
 * The Renovate comments help keep images up to date automatically.
 */
const defaultVersions = {
  // Dagger CI/CD Docker Images
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  alpine:
    "3.23.2@sha256:865b95f46d98cf867a156fe4a135ad3fe50d2056aa3f25ed31662dff6da4eb62",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  "alpine/helm":
    "4.1.0@sha256:905a068da43146a87a06c9c6f7f39cdb66a3cd0973dfc29607784f7172d8d171",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  "oven/bun":
    "1.3.9@sha256:856da45d07aeb62eb38ea3e7f9e1794c0143a4ff63efb00e6c4491b627e2a521",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  ubuntu:
    "noble@sha256:cd1dba651b3080c3686ecf4e3c4220f026b521fb76978881737d24f200828b2b",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  "curlimages/curl":
    "8.18.0@sha256:d94d07ba9e7d6de898b6d96c1a072f6f8266c687af78a74f380087a0addf5d17",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=semver
  caddy:
    "2.10.2@sha256:c3d7ee5d2b11f9dc54f947f68a734c84e9c9666c92c88a7f30b9cba5da182adb",
  // renovate: datasource=docker registryUrl=https://docker.io versioning=docker
  "alpine/kubectl":
    "1.35.0@sha256:e7e078c7bb25012141e5957d500834b2a5b266d6de20ecfa862b30d8a892fc7e",
  // renovate: datasource=github-releases versioning=semver
  "stackrox/kube-linter": "v0.8.1",
  // renovate: datasource=python-version versioning=semver
  python: "3.14.2",
  // renovate: datasource=node-version versioning=semver
  node: "24.13.0",

  // Tool versions (not Docker images)
  // renovate: datasource=npm versioning=semver
  "claude-code": "2.1.45",
  // renovate: datasource=npm versioning=semver
  playwright: "1.57.0",
  // renovate: datasource=npm versioning=semver
  "release-please": "17.1.3",
  // renovate: datasource=github-tags versioning=semver
  rust: "1.85",
  // renovate: datasource=github-releases versioning=semver
  sccache: "0.9.1",

  // Derived versions (computed from above)
  // not managed by renovate
  bun: "",
  // not managed by renovate
  helm: "",
};

// Extract version numbers without SHA for tools
const bunVersion = defaultVersions["oven/bun"].split("@")[0];
if (bunVersion === undefined) {
  throw new Error("Failed to parse bun version");
}
defaultVersions.bun = bunVersion;

const helmVersion = defaultVersions["alpine/helm"].split("@")[0];
if (helmVersion === undefined) {
  throw new Error("Failed to parse helm version");
}
defaultVersions.helm = helmVersion;

// Extract caddy version without digest for use with variant tags (-alpine, -builder-alpine)
// The base caddy digest doesn't apply to variants which have different content
const parsedCaddyVersion = defaultVersions.caddy.split("@")[0];
if (parsedCaddyVersion === undefined) {
  throw new Error("Failed to parse caddy version");
}
const caddyVersionOnly: string = parsedCaddyVersion;

export type Versions = typeof defaultVersions;

export const versions = defaultVersions;
export { caddyVersionOnly };
export default versions;
