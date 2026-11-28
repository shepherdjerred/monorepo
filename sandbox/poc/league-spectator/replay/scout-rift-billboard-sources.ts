export const sennaGroundHitResourceKey = 0x6bb08197;
export const riftBillboardSources = {
  "senna-w-ground-impact-flare": {
    resourceKey: sennaGroundHitResourceKey,
    champion: "Senna",
    skinId: 18,
    scale: Math.fround(0.9),
    repeatOrigin: false,
  },
  "heimerdinger-w-impact": {
    resourceKey: 0x0fb3cb06,
    champion: "Heimerdinger",
    skinId: 4,
    scale: 1,
    repeatOrigin: true,
  },
  "heimerdinger-q-ammo-spend": {
    resourceKey: 0x45f7e988,
    champion: "Heimerdinger",
    skinId: 4,
    scale: 1,
    repeatOrigin: true,
  },
  "kaisa-e-activation": {
    resourceKey: 0xa216a0e4,
    champion: "Kaisa",
    skinId: 15,
    scale: 1,
    repeatOrigin: false,
  },
  "senna-soul-death": {
    resourceKey: 0x06896eea,
    champion: "Senna",
    skinId: 18,
    scale: 1,
    repeatOrigin: false,
  },
} as const;
export const riftGroundGlowSource = {
  resourceKey: 0x685154d2,
  champion: "Maokai",
  skinId: 33,
  scale: 1.25,
  repeatOrigin: true,
} as const;
export type RiftBillboardSource =
  | (typeof riftBillboardSources)[keyof typeof riftBillboardSources]
  | typeof riftGroundGlowSource;
