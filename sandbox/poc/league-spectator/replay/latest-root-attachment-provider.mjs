// These leaf kernels do not select an entity's concrete provider or recover a
// transform. The caller must supply the original owner's root-position result.
export const ROOT_ATTACHMENT_PROVIDER_PROOF = Object.freeze({
  build: "16.21.829.8620",
  protocol: "20e09df23c66b85e",
  decoderImageSha256:
    "3e119190cfe42ea92e816107df229d3bd390547b846ca75bc161735e155e3ec7",
  blocks: Object.freeze([
    Object.freeze({
      rva: 0x367f70,
      size: 94,
      sha256:
        "47ff8644f0c7302ac3c89ee264180c9e1d8938ca63f1112dff521ac7fff577fc",
    }),
    Object.freeze({
      rva: 0x1755cf0,
      size: 13,
      sha256:
        "d7487bb30f3b1ec2e78bed8b892907b4c106c190de0dd14515e307a8ff78c3e9",
    }),
    Object.freeze({
      rva: 0x1766576,
      size: 143,
      sha256:
        "e32cf6c0b2978b4225b412a0af3a3dff46a2566147d5fac4f1cd7fc0802acde8",
    }),
    Object.freeze({
      rva: 0x76f720,
      size: 330,
      sha256:
        "ff389bfc64f774be56a8850798cdd0fb4c4d4f0e3d3d694626c7e5b666d0c25e",
    }),
  ]),
  providerFactorySelectionEstablished: false,
  concreteHeroRootPositionEstablished: false,
  matchAttachmentsResolved: false,
});

export const HERO_ROOT_SELECTION_PROOF = Object.freeze({
  rootGetter: Object.freeze({
    rva: 0x111160,
    size: 144,
    sha256: "f22e0cac24cfb448d4378b4483e525c6c5feec16dc0ca4f33cd18b25fc983125",
  }),
  proxyLookup: Object.freeze({
    rva: 0x18df40,
    size: 71,
    sha256: "3d176c04f02a2730145d3315db378af97b3f93c4474918e6f7d65bec8e6d6eb5",
  }),
  nativeColdProxyAndOverrideControls: true,
  nonzeroProxyResolutionControlled: false,
  actualProxyAndOverrideTracksRecovered: false,
});

const uint = (n) => Number.isInteger(n) && n >= 0 && n <= 0xffffffff;

export function createLatestRootAttachmentProviderKernels(profile) {
  if (
    profile?.clientVersion !== ROOT_ATTACHMENT_PROVIDER_PROOF.build ||
    profile.protocolDigest !== ROOT_ATTACHMENT_PROVIDER_PROOF.protocol ||
    profile.decoderImageSha256 !==
      ROOT_ATTACHMENT_PROVIDER_PROOF.decoderImageSha256
  )
    throw Error("Exact root-attachment provider build required");
  return Object.freeze({
    proof: ROOT_ATTACHMENT_PROVIDER_PROOF,
    // Original 367f70 preserves existing object flags. This is a wrapper-mask
    // conversion, not a packet descriptor flag decoder or lifecycle mask.
    mapWrapperFlags(wrapperFlags, existingObjectFlags) {
      if (!uint(wrapperFlags) || !uint(existingObjectFlags))
        throw Error("Unsigned original wrapper and object flags required");
      return (
        (existingObjectFlags |
          (wrapperFlags & 2) |
          ((wrapperFlags << 4) & 0x10) |
          ((wrapperFlags & 4) << 3) |
          ((wrapperFlags & 0x18) << 5)) >>>
        0
      );
    },
    requiresSourceMatrix(objectFlags) {
      if (!uint(objectFlags))
        throw Error("Unsigned original object flags required");
      return (objectFlags & 0x30) === 0x10;
    },
    copyRootPosition(attachmentKey, ownerRootPosition) {
      if (!uint(attachmentKey)) throw Error("Unsigned attachment key required");
      if (attachmentKey !== 0)
        throw Error("Bone and nonzero attachment provider not translated");
      if (
        !Array.isArray(ownerRootPosition) ||
        ownerRootPosition.length !== 3 ||
        !ownerRootPosition.every(
          (n) => Number.isFinite(n) && Number.isFinite(Math.fround(n)),
        )
      )
        throw Error("Finite original owner root-position result required");
      return ownerRootPosition.map(Math.fround);
    },
    // Original 111160 queries the proxy first. Only an observed lookup miss
    // permits the override/base branches. An unknown proxy must never become
    // a detached or base-position fallback.
    selectHeroRootPosition({
      proxyLookup,
      overrideFirstBits,
      overridePosition,
      basePosition,
    }) {
      if (
        !proxyLookup ||
        !["absent", "resolved", "unknown"].includes(proxyLookup.status)
      )
        throw Error("Explicit Hero proxy lookup status required");
      if (proxyLookup.status === "unknown")
        return {
          resolved: false,
          reasons: ["world:hero-root-proxy-lookup-unresolved"],
        };
      if (proxyLookup.status === "resolved")
        return {
          resolved: false,
          reasons: ["world:hero-root-proxy-getter-not-controlled"],
        };
      if (overrideFirstBits === null)
        return {
          resolved: false,
          reasons: ["world:hero-root-override-state-unresolved"],
        };
      if (!uint(overrideFirstBits))
        throw Error("Observed Hero override first-word bits required");
      const source =
        overrideFirstBits === 0x7f7fffff
          ? "base-position"
          : "override-position";
      const point =
        source === "base-position" ? basePosition : overridePosition;
      if (point === null)
        return {
          resolved: false,
          reasons: [`world:hero-root-${source}-unresolved`],
        };
      const position = this.copyRootPosition(0, point);
      if (source === "override-position") {
        const view = new DataView(new ArrayBuffer(4));
        view.setFloat32(0, position[0], true);
        if (view.getUint32(0, true) !== overrideFirstBits)
          throw Error(
            "Hero override position disagrees with observed first-word bits",
          );
      }
      return { resolved: true, position, source, reasons: [] };
    },
    resolveRegisteredHeroRootPosition({
      entityId,
      animationComponent,
      rootSelection,
    }) {
      if (
        !uint(entityId) ||
        entityId === 0 ||
        !animationComponent ||
        !["registered", "absent", "unknown"].includes(animationComponent.status)
      )
        throw Error(
          "Explicit nonzero Hero identity and animation-component state required",
        );
      if (animationComponent.status !== "registered")
        return {
          resolved: false,
          reasons: [
            `world:hero-animation-component-${animationComponent.status}`,
          ],
        };
      if (animationComponent.ownerEntityId !== entityId)
        throw Error("Animation component owner differs from source Hero");
      return this.selectHeroRootPosition(rootSelection);
    },
  });
}
