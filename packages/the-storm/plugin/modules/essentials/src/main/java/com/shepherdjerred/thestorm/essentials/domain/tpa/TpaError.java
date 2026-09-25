package com.shepherdjerred.thestorm.essentials.domain.tpa;

import java.util.UUID;

/** Why a teleport request could not be sent, accepted or denied. */
public sealed interface TpaError {

  /** A player asked to teleport to themself. */
  record SelfRequest() implements TpaError {}

  /** The player has no live request to answer. */
  record NoPendingRequest() implements TpaError {}

  /** The player has no live request from {@code requester}. */
  record NoRequestFrom(UUID requester) implements TpaError {}
}
