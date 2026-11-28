import rawCatalog from "@shepherdjerred/version-catalog/catalog.json";
import {
  parseVersionCatalog,
  versionCatalogMap,
} from "@shepherdjerred/version-catalog";
import { firstPartyImageRepository } from "@shepherdjerred/version-catalog/image-registry";
import { VersionMapSchema } from "./version-map.generated.ts";
export const versionCatalog = parseVersionCatalog(rawCatalog);
const versions = VersionMapSchema.parse(versionCatalogMap(versionCatalog));

/** Synthesis recipe only: the final binding pass replaces it with a required selection. */
export function firstPartyImageRecipe(name: string): string {
  return `${firstPartyImageRepository(name)}:delivery-recipe`;
}

const IMMUTABLE_DIGEST = /^sha256:[a-f0-9]{64}$/u;
const PLACEHOLDER_DIGEST = `sha256:${"0".repeat(64)}`;

/**
 * The image a first-party chart may render: its synthesis recipe, or a
 * published immutable digest of its own repository
 * (`docker.io/shepherdjerred/<name>@sha256:…`). A mutable tag, another
 * repository or the all-zero placeholder digest fails synthesis.
 */
export function requireFirstPartyImage(name: string, image: string): string {
  if (image === firstPartyImageRecipe(name)) return image;
  const prefix = `${firstPartyImageRepository(name)}@`;
  const digest = image.startsWith(prefix)
    ? image.slice(prefix.length)
    : undefined;
  if (
    digest === undefined ||
    digest === PLACEHOLDER_DIGEST ||
    !IMMUTABLE_DIGEST.test(digest)
  )
    throw new Error(
      `${name} requires its Delivery recipe or a published immutable image digest, not ${image}`,
    );
  return image;
}

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
  "b581e07c34c2cb6c2c19bbc7f4b733f19ad4d5703aea91d0c5d4cd1a29b9a98c";

/**
 * SHA-256 of the GitHub release tarball for `basnijholt/adaptive-lighting`,
 * pinned to the version above. See EUFY_TARBALL_SHA256 for why this exists.
 *
 * To regenerate after a version bump:
 *   VERSION=$(bun -e 'import v from "./src/versions.ts"; console.log(v["basnijholt/adaptive-lighting"])')
 *   curl -fSL "https://codeload.github.com/basnijholt/adaptive-lighting/tar.gz/refs/tags/$VERSION" | sha256sum
 */
export const ADAPTIVE_LIGHTING_TARBALL_SHA256 =
  "ac29d5e76cb8461e882f0f13c60fd438b83fdce0e23e18690f50ed3f10a07934";

/**
 * SHA-256 of the GitHub release tarball for `JeffSteinbok/hass-dreo`, pinned
 * to the version above. See EUFY_TARBALL_SHA256 for why this exists.
 *
 * To regenerate after a version bump:
 *   VERSION=$(bun -e 'import v from "./src/versions.ts"; console.log(v["JeffSteinbok/hass-dreo"])')
 *   curl -fSL "https://codeload.github.com/JeffSteinbok/hass-dreo/tar.gz/refs/tags/$VERSION" | sha256sum
 */
export const DREO_TARBALL_SHA256 =
  "2df11ef6887f48f9801455af6da494918aaa33cbc6503fda29c271c5ace1f9e8";

/**
 * SHA-256 of the GitHub release tarball for `magico13/ha-emporia-vue`,
 * pinned to the version above. See EUFY_TARBALL_SHA256 for why this exists.
 *
 * To regenerate after a version bump:
 *   VERSION=$(bun -e 'import v from "./src/versions.ts"; console.log(v["magico13/ha-emporia-vue"])')
 *   curl -fSL "https://codeload.github.com/magico13/ha-emporia-vue/tar.gz/refs/tags/$VERSION" | sha256sum
 */
export const EMPORIA_VUE_TARBALL_SHA256 =
  "f3372a4b4f533d60128b9d1844f2cdd55d314c221c2ee1159f345fde151a5109";

/**
 * SHA-256 of the GitHub release tarball for `dlarrick/hass-kumo`, pinned to
 * the version above. See EUFY_TARBALL_SHA256 for why this exists.
 *
 * To regenerate after a version bump:
 *   VERSION=$(bun -e 'import v from "./src/versions.ts"; console.log(v["dlarrick/hass-kumo"])')
 *   curl -fSL "https://codeload.github.com/dlarrick/hass-kumo/tar.gz/refs/tags/$VERSION" | sha256sum
 */
export const KUMO_TARBALL_SHA256 =
  "e47bc5899f582c5edb9b3aed32ee698994145e016833a8c7866c2d42ee5d0ae1";

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
  "ff0f247771826b6226a625923d21e4e472f21c45045c90b9bcecbd4f48eaa8dc";

/**
 * SHA-256 of the GitHub release tarball for `AlexxIT/SonoffLAN`, pinned to
 * the version above. See EUFY_TARBALL_SHA256 for why this exists.
 *
 * To regenerate after a version bump:
 *   VERSION=$(bun -e 'import v from "./src/versions.ts"; console.log(v["AlexxIT/SonoffLAN"])')
 *   curl -fSL "https://codeload.github.com/AlexxIT/SonoffLAN/tar.gz/refs/tags/$VERSION" | sha256sum
 */
export const SONOFF_TARBALL_SHA256 =
  "9ba430f7871a330698d04207dcbb738f3da410dda4c84e17480e516e0e537485";

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
  "008078956fb7a19a5842a02e7bfc0c79849e2fd4df39f301daa45f44dcdc62b9";

export default versions;
