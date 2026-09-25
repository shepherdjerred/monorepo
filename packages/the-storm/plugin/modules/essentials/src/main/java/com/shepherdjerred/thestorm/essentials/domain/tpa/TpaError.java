package com.shepherdjerred.thestorm.essentials.domain.tpa;

import java.time.Duration;
import java.util.UUID;

/** Why a teleport request could not be sent, accepted or denied. */
public sealed interface TpaError {

  /** A player asked to teleport to themself. */
  record SelfRequest() implements TpaError {}

  /** The target has turned requests off with {@code /tptoggle}. */
  record NotAccepting() implements TpaError {}

  /** The requester sent a request too recently. */
  record TooSoon(Duration remaining) implements TpaError {}

  /**
   * The requester already has a live request to this target in the other direction; it must be
   * answered or expire first.
   */
  record Conflicting(TpaRequest.Direction pending) implements TpaError {}

  /** The player has no live request to answer. */
  record NoPendingRequest() implements TpaError {}

  /** The player has no live request from {@code requester}. */
  record NoRequestFrom(UUID requester) implements TpaError {}

  /** The named request is not the requester's live request (it was replaced or has expired). */
  record NoSuchRequest(long id) implements TpaError {}
}
