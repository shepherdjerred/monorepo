import { createHash } from "node:crypto";
import type { ContainerProps } from "cdk8s-plus-31";
import { Cpu } from "cdk8s-plus-31";
import { Size } from "cdk8s";
import {
  ROOT_GID,
  ROOT_UID,
} from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import versions, {
  ADAPTIVE_LIGHTING_TARBALL_SHA256,
  CUSTOM_BRAND_ICONS_TARBALL_SHA256,
  DREO_TARBALL_SHA256,
  EMPORIA_VUE_TARBALL_SHA256,
  EUFY_TARBALL_SHA256,
  KUMO_TARBALL_SHA256,
  MYSA_TARBALL_SHA256,
  PETLIBRO_TARBALL_SHA256,
  SONOFF_TARBALL_SHA256,
} from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

/** How a component's release tarball maps onto the HA config PVC. */
export type HaComponentInstallSpec =
  | {
      /** Whole `custom_components/<slug>` subdir copied verbatim (HACS "integration" shape). */
      kind: "custom_components";
      /** Directory name under `custom_components/` — also the HA integration domain. */
      slug: string;
      /**
       * Checked-in `.patch` files under `patches/<slug>/`, applied via `patch -p1`
       * (in numbered-prefix order) against the extracted tarball before it's copied
       * into place. Read at cdk8s synth time and inlined into the generated shell
       * script — no ConfigMap/volume plumbing needed.
       */
      patches?: string[];
    }
  | {
      /** Specific pre-built files copied into `www/community/<slug>/` (HACS "plugin" shape). */
      kind: "www_community";
      slug: string;
      /** Paths relative to the extracted tarball root, copied verbatim into the target dir. */
      files: string[];
    };

export type HaCustomComponentSpec = {
  /** `owner/repo` on GitHub — also the literal key into `versions.ts`. */
  repo: string;
  version: string;
  sha256: string;
  /** Name of the exported `_TARBALL_SHA256` constant, for human-readable test output. */
  sha256ConstName: string;
  install: HaComponentInstallSpec;
};

export const HA_CUSTOM_COMPONENTS: HaCustomComponentSpec[] = [
  {
    repo: "basnijholt/adaptive-lighting",
    version: versions["basnijholt/adaptive-lighting"],
    sha256: ADAPTIVE_LIGHTING_TARBALL_SHA256,
    sha256ConstName: "ADAPTIVE_LIGHTING_TARBALL_SHA256",
    install: { kind: "custom_components", slug: "adaptive_lighting" },
  },
  {
    repo: "JeffSteinbok/hass-dreo",
    version: versions["JeffSteinbok/hass-dreo"],
    sha256: DREO_TARBALL_SHA256,
    sha256ConstName: "DREO_TARBALL_SHA256",
    install: { kind: "custom_components", slug: "dreo" },
  },
  {
    repo: "magico13/ha-emporia-vue",
    version: versions["magico13/ha-emporia-vue"],
    sha256: EMPORIA_VUE_TARBALL_SHA256,
    sha256ConstName: "EMPORIA_VUE_TARBALL_SHA256",
    install: { kind: "custom_components", slug: "emporia_vue" },
  },
  {
    repo: "dlarrick/hass-kumo",
    version: versions["dlarrick/hass-kumo"],
    sha256: KUMO_TARBALL_SHA256,
    sha256ConstName: "KUMO_TARBALL_SHA256",
    install: { kind: "custom_components", slug: "kumo" },
  },
  {
    // True upstream, not the retired shepherdjerred/Mysa_HA fork -- the 3
    // commits that used to live on that fork (device setpoint limits fix)
    // are now a checked-in patch instead.
    repo: "kgelinas/Mysa_HA",
    version: versions["kgelinas/Mysa_HA"],
    sha256: MYSA_TARBALL_SHA256,
    sha256ConstName: "MYSA_TARBALL_SHA256",
    install: {
      kind: "custom_components",
      slug: "mysa",
      patches: ["0001-expose-device-setpoint-limits.patch"],
    },
  },
  {
    repo: "jjjonesjr33/petlibro",
    version: versions["jjjonesjr33/petlibro"],
    sha256: PETLIBRO_TARBALL_SHA256,
    sha256ConstName: "PETLIBRO_TARBALL_SHA256",
    install: { kind: "custom_components", slug: "petlibro" },
  },
  {
    repo: "AlexxIT/SonoffLAN",
    version: versions["AlexxIT/SonoffLAN"],
    sha256: SONOFF_TARBALL_SHA256,
    sha256ConstName: "SONOFF_TARBALL_SHA256",
    install: { kind: "custom_components", slug: "sonoff" },
  },
  {
    // Upstream directly (no fork) -- two source-level bug fixes (crash on
    // aiohttp keepalive timeout; persistent notification never
    // auto-dismissing on reconnect) are checked-in patches instead.
    repo: "fuatakgun/eufy_security",
    version: versions["fuatakgun/eufy_security"],
    sha256: EUFY_TARBALL_SHA256,
    sha256ConstName: "EUFY_TARBALL_SHA256",
    install: {
      kind: "custom_components",
      slug: "eufy_security",
      patches: [
        "0001-check-message-type-before-json.patch",
        "0002-dismiss-notification-on-reconnect.patch",
      ],
    },
  },
  {
    // Frontend plugin (HACS "plugin" category), not an integration: ships a
    // pre-built dist/ bundle, not custom_components/.
    repo: "elax46/custom-brand-icons",
    version: versions["elax46/custom-brand-icons"],
    sha256: CUSTOM_BRAND_ICONS_TARBALL_SHA256,
    sha256ConstName: "CUSTOM_BRAND_ICONS_TARBALL_SHA256",
    install: {
      kind: "www_community",
      slug: "custom-brand-icons",
      files: ["dist/custom-brand-icons.js", "dist/custom-brand-icons.js.gz"],
    },
  },
];

function containerNameFor(spec: HaCustomComponentSpec): string {
  return `install-${spec.install.slug.replaceAll(/[_.]/g, "-")}`;
}

async function readPatches(
  slug: string,
  patchFiles: string[],
): Promise<string[]> {
  return Promise.all(
    patchFiles.map((patchFile) =>
      Bun.file(
        `${import.meta.dir}/../../../patches/${slug}/${patchFile}`,
      ).text(),
    ),
  );
}

/**
 * Fingerprint of everything that changes the installed bytes: the upstream
 * tag, the tarball hash, and any checked-in patch contents. Written to the
 * PVC's `.installed_version` marker so a changed patch or hash (without a tag
 * bump) still forces a reinstall instead of leaving stale bytes in place.
 */
function installMarker(
  spec: HaCustomComponentSpec,
  patchContents: string[],
): string {
  const hash = createHash("sha256");
  hash.update(spec.version);
  hash.update("\0");
  hash.update(spec.sha256);
  for (const content of patchContents) {
    hash.update("\0");
    hash.update(content);
  }
  return `${spec.version}-${hash.digest("hex").slice(0, 16)}`;
}

async function buildInstallScript(
  spec: HaCustomComponentSpec,
): Promise<string> {
  const { repo, version, sha256 } = spec;

  if (spec.install.kind === "custom_components") {
    const { slug, patches } = spec.install;
    const patchContents = patches ? await readPatches(slug, patches) : [];
    const marker = installMarker(spec, patchContents);
    // Patch content is base64-encoded rather than inlined as a raw heredoc: a
    // patch's diff hunks routinely contain lines that are pure whitespace
    // (context lines for blank source lines). The `yaml` package cdk8s uses to
    // serialize manifests represents an embedded newline inside a long
    // double-quoted scalar via YAML's line-folding escape syntax, and mis-
    // round-trips a whitespace-only line back into a literal `\` -- reproducible
    // even parsing the library's own output back with itself, not just a
    // cross-implementation quirk. That corrupts the patch and fails it with
    // "malformed patch" at runtime. Base64 has no embedded newlines or special
    // YAML characters, so it can't trip this escaping bug regardless of which
    // YAML parser touches the manifest downstream (cdk8s, Helm, ArgoCD, kubectl).
    const patchSteps = patchContents
      .map(
        (content, i) => `
echo "applying patch ${String(i + 1)}/${String(patchContents.length)} to ${slug}"
echo '${Buffer.from(content).toString("base64")}' | base64 -d | patch -p1 -d "$STAGE"`,
      )
      .join("\n");

    return String.raw`
set -eu
VERSION="${version}"
INSTALL_MARKER="${marker}"
EXPECTED_SHA256="${sha256}"
TARGET_DIR="/config/custom_components/${slug}"
MARKER="$TARGET_DIR/.installed_version"

if [ -f "$MARKER" ] && [ "$(cat "$MARKER")" = "$INSTALL_MARKER" ]; then
  echo "${slug} $VERSION already installed"
  exit 0
fi

apk add --no-cache curl tar patch
STAGE=$(mktemp -d)
ARCHIVE="$(mktemp)"
curl -fSL "https://github.com/${repo}/archive/refs/tags/$VERSION.tar.gz" \
  -o "$ARCHIVE"
echo "$EXPECTED_SHA256  $ARCHIVE" | sha256sum -c -
tar -xz -C "$STAGE" --strip-components=1 -f "$ARCHIVE"
rm -f "$ARCHIVE"
${patchSteps}

mkdir -p /config/custom_components
rm -rf "$TARGET_DIR"
cp -r "$STAGE/custom_components/${slug}" "$TARGET_DIR"
echo "$INSTALL_MARKER" > "$MARKER"
echo "installed ${slug} $VERSION"
`;
  }

  // www_community: copy specific pre-built files, not a whole subdir.
  const { slug, files } = spec.install;
  const targetDir = `/config/www/community/${slug}`;
  const marker = installMarker(spec, []);
  const copyLines = files
    .map((f) => `cp "$STAGE/${f}" "${targetDir}/${f.split("/").pop() ?? f}"`)
    .join("\n");

  return String.raw`
set -eu
VERSION="${version}"
INSTALL_MARKER="${marker}"
EXPECTED_SHA256="${sha256}"
TARGET_DIR="${targetDir}"
MARKER="$TARGET_DIR/.installed_version"

if [ -f "$MARKER" ] && [ "$(cat "$MARKER")" = "$INSTALL_MARKER" ]; then
  echo "${slug} $VERSION already installed"
  exit 0
fi

apk add --no-cache curl tar
STAGE=$(mktemp -d)
ARCHIVE="$(mktemp)"
curl -fSL "https://github.com/${repo}/archive/refs/tags/$VERSION.tar.gz" \
  -o "$ARCHIVE"
echo "$EXPECTED_SHA256  $ARCHIVE" | sha256sum -c -
tar -xz -C "$STAGE" --strip-components=1 -f "$ARCHIVE"
rm -f "$ARCHIVE"

rm -rf "$TARGET_DIR"
mkdir -p "$TARGET_DIR"
${copyLines}
echo "$INSTALL_MARKER" > "$MARKER"
echo "installed ${slug} $VERSION"
`;
}

/**
 * Builds ContainerProps for one pinned HA custom-component install.
 * Generalizes the download/verify/extract/patch/copy shell logic that used
 * to be hand-written per component (originally only for eufy_security)
 * across both HACS install shapes: a `custom_components/<slug>` integration
 * directory-copy, or specific pre-built files copied into
 * `www/community/<slug>/` for a frontend plugin.
 */
export async function createHaCustomComponentInitContainer(
  spec: HaCustomComponentSpec,
): Promise<ContainerProps> {
  return {
    name: containerNameFor(spec),
    image: `docker.io/alpine:${versions["library/alpine"]}`,
    command: ["/bin/sh"],
    args: ["-c", await buildInstallScript(spec)],
    securityContext: {
      ensureNonRoot: false,
      user: ROOT_UID,
      group: ROOT_GID,
      readOnlyRootFilesystem: false,
      privileged: false,
      allowPrivilegeEscalation: false,
    },
    // K8s takes max(), not sum(), of sequential init-container resource
    // requests, so these stay small regardless of component count.
    resources: {
      cpu: { request: Cpu.millis(100), limit: Cpu.millis(500) },
      memory: { request: Size.mebibytes(128), limit: Size.mebibytes(512) },
    },
    volumeMounts: [],
  };
}

function buildPruneScript(specs: HaCustomComponentSpec[]): string {
  const declaredIntegrations = specs
    .filter((s) => s.install.kind === "custom_components")
    .map((s) => s.install.slug);
  const declaredPlugins = specs
    .filter((s) => s.install.kind === "www_community")
    .map((s) => s.install.slug);

  return `
set -eu

DECLARED_INTEGRATIONS="${declaredIntegrations.join(" ")}"
DECLARED_PLUGINS="${declaredPlugins.join(" ")}"

is_declared() {
  needle="$1"
  shift
  for item in "$@"; do
    [ "$item" = "$needle" ] && return 0
  done
  return 1
}

if [ -d /config/custom_components ]; then
  for dir in /config/custom_components/*/; do
    [ -d "$dir" ] || continue
    name="$(basename "$dir")"
    if [ "$name" = "hacs" ] || ! is_declared "$name" $DECLARED_INTEGRATIONS; then
      echo "pruning undeclared custom_components/$name"
      rm -rf "$dir"
    fi
  done
fi

if [ -d /config/www/community ]; then
  for dir in /config/www/community/*/; do
    [ -d "$dir" ] || continue
    name="$(basename "$dir")"
    if ! is_declared "$name" $DECLARED_PLUGINS; then
      echo "pruning undeclared www/community/$name"
      rm -rf "$dir"
    fi
  done
fi

# HACS is fully retired -- nothing installs through it anymore. Remove its
# state files so a stale hacs.repositories doesn't mislead anyone reading
# .storage, and so HACS's own config entry (if still registered) has
# nothing to reconcile against on next HA restart.
rm -f /config/.storage/hacs.critical
rm -f /config/.storage/hacs.data
rm -f /config/.storage/hacs.hacs
rm -f /config/.storage/hacs.repositories

echo "prune complete"
`;
}

/** Builds ContainerProps for the final "delete anything undeclared" init container. */
export function createPruneStaleComponentsInitContainer(
  specs: HaCustomComponentSpec[],
): ContainerProps {
  return {
    name: "prune-stale-ha-components",
    image: `docker.io/alpine:${versions["library/alpine"]}`,
    command: ["/bin/sh"],
    args: ["-c", buildPruneScript(specs)],
    securityContext: {
      ensureNonRoot: false,
      user: ROOT_UID,
      group: ROOT_GID,
      readOnlyRootFilesystem: false,
      privileged: false,
      allowPrivilegeEscalation: false,
    },
    resources: {
      cpu: { request: Cpu.millis(50), limit: Cpu.millis(200) },
      memory: { request: Size.mebibytes(32), limit: Size.mebibytes(128) },
    },
    volumeMounts: [],
  };
}
