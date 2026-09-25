package com.shepherdjerred.thestorm.essentials.domain.tpa;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

/**
 * A request from {@code requester} to {@code target}. The requester always pays; who moves depends
 * on the direction. The id lets an accept name exactly the request the target was shown, so a
 * requester cannot swap a {@code /tpa} for a {@code /tpahere} under the target's click.
 *
 * @param id unique among the requests of this server run
 * @param requester the player who asked
 * @param target the player who may accept or deny
 * @param direction {@code /tpa} or {@code /tpahere}
 * @param sentAt when it was sent
 */
public record TpaRequest(
    long id, UUID requester, UUID target, Direction direction, Instant sentAt) {

  public TpaRequest {
    if (requester.equals(target)) {
      throw new IllegalArgumentException("a player cannot send a request to themself");
    }
  }

  /** Which way an accepted request moves a player. */
  public enum Direction {
    /** {@code /tpa}: the requester goes to the target. */
    TO_TARGET,
    /** {@code /tpahere}: the target comes to the requester. */
    TO_REQUESTER
  }

  /** The player who is teleported when the request is accepted. */
  public UUID mover() {
    return switch (direction) {
      case TO_TARGET -> requester;
      case TO_REQUESTER -> target;
    };
  }

  /** The player the mover is teleported to. */
  public UUID destination() {
    return switch (direction) {
      case TO_TARGET -> target;
      case TO_REQUESTER -> requester;
    };
  }

  /** Whether the request has lapsed at {@code now}: it is live strictly before sent + timeout. */
  public boolean isExpired(Duration timeout, Instant now) {
    return !now.isBefore(sentAt.plus(timeout));
  }
}
