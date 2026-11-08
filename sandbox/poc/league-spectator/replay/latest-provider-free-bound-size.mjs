export const PROVIDER_FREE_BOUND_SIZE_STATUS =
  "original-provider-free-wrapper-and-object-default-zero";

export const PROVIDER_FREE_BOUND_SIZE_BLOCKS = Object.freeze(
  [
    [
      0x369748,
      34,
      "70a32e2803a5496e028dbd6bdbc871348d644cfe2cad9bb26943236bc5a58679",
    ],
    [
      0x36ad54,
      149,
      "b03f7a4ea5ccb250d1cabcf264236415c5ae4ec89d69b4a764e63d4450b2ae2b",
    ],
    [
      0x36b090,
      20,
      "daea648427759a4221a5b181cd0da245b6dac2214c480423a9b4e91340e03043",
    ],
    [
      0x1755dc0,
      18,
      "ce76a7f33a76f3caa09ab2a0454b29468cf3e28f7f8f951611bc637745bb8da5",
    ],
    [
      0x1763fd0,
      313,
      "92f49706183a5d2ecda28d4871e0428bd15164238bd32d6a18bee681f2d7c237",
    ],
    [
      0x1765ea9,
      17,
      "4be03aded25da35576680efafa282a9692653a2a07248f63fc49ec9953e14858",
    ],
  ].map(Object.freeze),
);

// Source-provider-free descriptor factories keep wrapper+224=0. The wrapper
// copies it to object+100; original parent synchronization preserves that raw
// zero at parent+1cc. A distinct auxiliary audio anchor never populates the
// wrapper's source provider. This contract cannot supply an attached size.
export function createLatestProviderFreeBoundSize(profile) {
  if (
    profile.clientVersion !== "16.21.829.8620" ||
    profile.protocolDigest !== "20e09df23c66b85e" ||
    profile.decoderImageSha256 !==
      "3e119190cfe42ea92e816107df229d3bd390547b846ca75bc161735e155e3ec7"
  )
    throw Error("Exact provider-free bound-size build required");
  return Object.freeze({
    boundObjectSize: 0,
    boundObjectSizeStatus: PROVIDER_FREE_BOUND_SIZE_STATUS,
  });
}
