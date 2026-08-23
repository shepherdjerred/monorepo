import rawCatalog from "@shepherdjerred/version-catalog/catalog.json";
import {
  parseVersionCatalog,
  versionCatalogMap,
} from "@shepherdjerred/version-catalog";
import { VersionMapSchema } from "./version-map.generated.ts";
import { applyCurrentBuildImageOverrides } from "./release-configuration.ts";

export const versionCatalog = parseVersionCatalog(rawCatalog);
const versions = VersionMapSchema.parse(versionCatalogMap(versionCatalog));

applyCurrentBuildImageOverrides(versions);

/**
 * SHA-256 of the GitHub release tarball for `fuatakgun/eufy_security`, pinned
 * to the version above. Verified at install time by the Home Assistant init
 * container so a tampered or silently-reuploaded tag can't ship custom code
 * onto the config PVC. Verified BEFORE the two checked-in patches under
 * `patches/eufy_security/` are applied (see ha-custom-components.ts) — this
 * hash is of the pristine upstream tarball, not the patched result.
 *
 * Enforced by `ha-custom-component-integrity.test.ts` (CI-only): any Renovate
 * PR that bumps `fuatakgun/eufy_security` without updating this hash will
 * fail CI, and the same test also re-verifies both patches still apply
 * cleanly against the (possibly newer) pristine source.
 *
 * To regenerate after a version bump:
 *   VERSION=$(bun -e 'import v from "./src/versions.ts"; console.log(v["fuatakgun/eufy_security"])')
 *   curl -fSL "https://codeload.github.com/fuatakgun/eufy_security/tar.gz/refs/tags/$VERSION" | sha256sum
 */
export const EUFY_TARBALL_SHA256 =
  "b744aac0ce03a8a75de5100c672957504173c20cbe2ac0fc4d09d5bc75c59411";

/**
 * SHA-256 of the GitHub release tarball for `basnijholt/adaptive-lighting`,
 * pinned to the version above. See EUFY_TARBALL_SHA256 for why this exists.
 *
 * To regenerate after a version bump:
 *   VERSION=$(bun -e 'import v from "./src/versions.ts"; console.log(v["basnijholt/adaptive-lighting"])')
 *   curl -fSL "https://codeload.github.com/basnijholt/adaptive-lighting/tar.gz/refs/tags/$VERSION" | sha256sum
 */
export const ADAPTIVE_LIGHTING_TARBALL_SHA256 =
  "9c390346e022651778aaed613946a5275a503966274dfa399b966e0eb90f7ca4";

/**
 * SHA-256 of the GitHub release tarball for `JeffSteinbok/hass-dreo`, pinned
 * to the version above. See EUFY_TARBALL_SHA256 for why this exists.
 *
 * To regenerate after a version bump:
 *   VERSION=$(bun -e 'import v from "./src/versions.ts"; console.log(v["JeffSteinbok/hass-dreo"])')
 *   curl -fSL "https://codeload.github.com/JeffSteinbok/hass-dreo/tar.gz/refs/tags/$VERSION" | sha256sum
 */
export const DREO_TARBALL_SHA256 =
  "813efd3661734ed1f8320f633706c781cd284d7edb76313466e787dff3367f79";

/**
 * SHA-256 of the GitHub release tarball for `magico13/ha-emporia-vue`,
 * pinned to the version above. See EUFY_TARBALL_SHA256 for why this exists.
 *
 * To regenerate after a version bump:
 *   VERSION=$(bun -e 'import v from "./src/versions.ts"; console.log(v["magico13/ha-emporia-vue"])')
 *   curl -fSL "https://codeload.github.com/magico13/ha-emporia-vue/tar.gz/refs/tags/$VERSION" | sha256sum
 */
export const EMPORIA_VUE_TARBALL_SHA256 =
  "98c93e9420845c425d9e33fabf49426172a02868ee97cb5d0aa9cd759663a247";

/**
 * SHA-256 of the GitHub release tarball for `dlarrick/hass-kumo`, pinned to
 * the version above. See EUFY_TARBALL_SHA256 for why this exists.
 *
 * To regenerate after a version bump:
 *   VERSION=$(bun -e 'import v from "./src/versions.ts"; console.log(v["dlarrick/hass-kumo"])')
 *   curl -fSL "https://codeload.github.com/dlarrick/hass-kumo/tar.gz/refs/tags/$VERSION" | sha256sum
 */
export const KUMO_TARBALL_SHA256 =
  "34b88547e0809b7849ba1fc1a3f149777a1a44a1d97bc56fed734224fdfbef0b";

/**
 * SHA-256 of the GitHub release tarball for `kgelinas/Mysa_HA` (true
 * upstream, not the retired `shepherdjerred/Mysa_HA` fork), pinned to the
 * version above. Verified BEFORE the checked-in patch under
 * `patches/mysa/` is applied — this hash is of the pristine upstream
 * tarball, not the patched result. See EUFY_TARBALL_SHA256 for why this
 * exists.
 *
 * To regenerate after a version bump:
 *   VERSION=$(bun -e 'import v from "./src/versions.ts"; console.log(v["kgelinas/Mysa_HA"])')
 *   curl -fSL "https://codeload.github.com/kgelinas/Mysa_HA/tar.gz/refs/tags/$VERSION" | sha256sum
 */
export const MYSA_TARBALL_SHA256 =
  "9d8120570bec8f1befedac4b20d67d1fb726da8fdf249305e21fae0213d1a0d9";

/**
 * SHA-256 of the GitHub release tarball for `jjjonesjr33/petlibro`, pinned
 * to the version above. See EUFY_TARBALL_SHA256 for why this exists.
 *
 * To regenerate after a version bump:
 *   VERSION=$(bun -e 'import v from "./src/versions.ts"; console.log(v["jjjonesjr33/petlibro"])')
 *   curl -fSL "https://codeload.github.com/jjjonesjr33/petlibro/tar.gz/refs/tags/$VERSION" | sha256sum
 */
export const PETLIBRO_TARBALL_SHA256 =
  "42203f0fc8ea7a9fa80877633b36ed0cfd4ef4f86f904a994d35b121e44c607f";

/**
 * SHA-256 of the GitHub release tarball for `AlexxIT/SonoffLAN`, pinned to
 * the version above. See EUFY_TARBALL_SHA256 for why this exists.
 *
 * To regenerate after a version bump:
 *   VERSION=$(bun -e 'import v from "./src/versions.ts"; console.log(v["AlexxIT/SonoffLAN"])')
 *   curl -fSL "https://codeload.github.com/AlexxIT/SonoffLAN/tar.gz/refs/tags/$VERSION" | sha256sum
 */
export const SONOFF_TARBALL_SHA256 =
  "ce8fde8033260a191f498f71e37ac91ccef83f2388c1552d0d671c1fa718d0dc";

/**
 * SHA-256 of the GitHub release tarball for `elax46/custom-brand-icons`
 * (a frontend plugin, not an integration — see ha-custom-components.ts for
 * its different install shape), pinned to the version above. See
 * EUFY_TARBALL_SHA256 for why this exists.
 *
 * To regenerate after a version bump:
 *   VERSION=$(bun -e 'import v from "./src/versions.ts"; console.log(v["elax46/custom-brand-icons"])')
 *   curl -fSL "https://codeload.github.com/elax46/custom-brand-icons/tar.gz/refs/tags/$VERSION" | sha256sum
 */
export const CUSTOM_BRAND_ICONS_TARBALL_SHA256 =
  "3f1d70118cb1fa4d4ebbccaedf8c168a8a7e34ea1cfed5c18b01e7fb1c01d6de";

export default versions;
