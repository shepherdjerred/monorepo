export const ADDITIONAL_AUDIO_ANCHOR_POLICY =
  "packet-position-with-auxiliary-audio-anchor-omitted-v1";

export const ADDITIONAL_AUDIO_ANCHOR_BLOCKS = Object.freeze(
  [
    [
      0x83f2d7,
      100,
      "e92efa9bbb785e8be59fdce5d9773976811e3eb38e64f61e63d4b4ed520e9cda",
    ],
    [
      0x36b710,
      114,
      "97c29bd65eedd20476df68782b2dc43a55aaddd07786aa7cd1ac7e7f6251821f",
    ],
    [
      0x1765960,
      228,
      "f4ffee15b8b0f162460a76ce9ba9a22e11a9f755ad2fc829bde0c96d04f179fb",
    ],
    [
      0x54f630,
      238,
      "3c57b12576a6a9a63c4aa38a2bb28eb3597ad26b75b53c4a1ca26fb763265a0e",
    ],
    [
      0x54ced0,
      208,
      "efa7feeaabef476cd668c2f35cbb9ce43a3c5463630d262838ab776dee4fa9f1",
    ],
  ].map(Object.freeze),
);

// Original 83f2d7 selects an independent key-zero provider with 54f630;
// 36b710 stores it at object+190/+198 without changing position or basis.
// Original 1765960 consumes that provider for its audio anchor. The shared
// visual sync/scheduler/particle/writer differential does not dereference it.
// This explicit partial policy omits those audio/ownership side effects. It
// does not recover the concrete provider's pose or native unit acceptance.
export function createLatestAdditionalAudioAnchorPolicy(profile) {
  if (
    profile.clientVersion !== "16.21.829.8620" ||
    profile.protocolDigest !== "20e09df23c66b85e" ||
    profile.decoderImageSha256 !==
      "3e119190cfe42ea92e816107df229d3bd390547b846ca75bc161735e155e3ec7"
  )
    throw Error("Exact additional audio-anchor build required");
  return Object.freeze({
    policy: ADDITIONAL_AUDIO_ANCHOR_POLICY,
    inspect(reference) {
      if (
        reference?.field !== "lookupA8EntityId" ||
        !Number.isInteger(reference.entityId) ||
        reference.entityId <= 0 ||
        reference.entityId > 0xffffffff ||
        reference.status !== "registered" ||
        reference.entity?.entityId !== reference.entityId
      )
        throw Error("Registered auxiliary audio-anchor identity required");
      if (reference.entity.entityClass !== "champion")
        return {
          allowed: false,
          reasons: [
            `world:additional-provider-class-unproven:${reference.entity.entityClass ?? "unknown"}`,
          ],
        };
      return {
        allowed: true,
        reasons: [
          "audio:auxiliary-provider-anchor-getters-omitted",
          "lifecycle:auxiliary-provider-shared-and-weak-ownership-omitted",
          "world:auxiliary-provider-native-unit-acceptance-unrecovered",
        ],
      };
    },
  });
}
