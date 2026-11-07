// Static build evidence only. No recorded match state or packet identities are
// installed here; the browser derives each partial prefix from decoded inputs.
export const INITIAL_VISIBILITY_PREFIX_POLICY =
  "native-initial-ai-client-component-prefix-v1";
export const INITIAL_VISIBILITY_PREFIX_PROOF = Object.freeze({
  build: "16.21.829.8620",
  protocol: "20e09df23c66b85e",
  decoderImageSha256:
    "3e119190cfe42ea92e816107df229d3bd390547b846ca75bc161735e155e3ec7",
  blocks: Object.freeze([
    Object.freeze({
      rva: 0x66a140,
      bytes: 45,
      sha256:
        "fac2176e1fd0876aad6cb5f3c6f1c99302d2ca7f435e5674986368e313179fe5",
    }),
    Object.freeze({
      rva: 0xea42f,
      bytes: 225,
      sha256:
        "90562ff4fd9f69bd11a3e70d047d28d780329028e48df9721b433270c6b24225",
    }),
    Object.freeze({
      rva: 0x21b103,
      bytes: 153,
      sha256:
        "a614a1d9850b4329f4e2777abcffa8bed2ff48efa9b5fbcf2405188eeab982a9",
    }),
    Object.freeze({
      rva: 0x21b710,
      bytes: 78,
      sha256:
        "ee5487896ee1177825a49d783a850da5de85c746870822930ef65c259fd2cb9d",
    }),
  ]),
  ownerCallbackExecuted: false,
  nativeWorldAcceptanceRecovered: false,
});

export function initialVisibilityPrefixEligibility(registration, event) {
  if (
    registration?.componentClass !== "ai-client" ||
    registration.creationSourceKind !== "hero-creation-candidate"
  )
    return "visibility:initial-concrete-ai-client-registration-unproven";
  if (
    registration.creationStream !== 2 ||
    registration.creationTime !== 0 ||
    !Number.isSafeInteger(registration.creationChunkId) ||
    registration.creationChunkId < 0 ||
    !Number.isSafeInteger(registration.creationTransportSequence) ||
    registration.creationTransportSequence < 0 ||
    !Number.isSafeInteger(registration.creationEntryOrder ?? 0) ||
    (registration.creationEntryOrder ?? 0) < 0
  )
    return "visibility:initial-snapshot-registration-unproven";
  if (
    event?.stream !== 2 ||
    event.opcode !== 822 ||
    event.time !== 0 ||
    event.chunkId !== registration.creationChunkId
  )
    return "visibility:not-the-registered-initial-snapshot-primary";
  if (event.entityId !== registration.entityId)
    return "visibility:initial-component-network-identity-mismatch";
  const order =
    event.transportSequence - registration.creationTransportSequence ||
    event.entryOrder - (registration.creationEntryOrder ?? 0);
  if (
    !Number.isSafeInteger(event.transportSequence) ||
    event.transportSequence < 0 ||
    !Number.isSafeInteger(event.entryOrder) ||
    event.entryOrder < 0 ||
    order <= 0
  )
    return "visibility:initial-component-registration-not-before-primary";
  return null;
}
