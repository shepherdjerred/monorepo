package com.shepherdjerred.thestorm.essentials.domain.moderation;

import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

/**
 * One line of the moderation audit log. The log is append-only; a player's current standing is
 * replayed from it.
 *
 * @param target the player acted on
 * @param action what was done
 * @param actor who did it
 * @param reason why, shown to the player
 * @param at when
 * @param expiresAt when a temporary ban ends; empty when permanent or not applicable
 */
public record AuditEntry(
    UUID target,
    ModerationAction action,
    Actor actor,
    String reason,
    Instant at,
    Optional<Instant> expiresAt) {

  /** The longest reason kept. */
  public static final int MAX_REASON_LENGTH = 256;

  public AuditEntry {
    if (reason.isBlank() || reason.length() > MAX_REASON_LENGTH) {
      throw new IllegalArgumentException("reason must be 1-" + MAX_REASON_LENGTH + " characters");
    }
    if (expiresAt.isPresent() && !action.canExpire()) {
      throw new IllegalArgumentException(action + " cannot expire");
    }
    if (expiresAt.isPresent() && !expiresAt.orElseThrow().isAfter(at)) {
      throw new IllegalArgumentException("expiry must be after the action");
    }
  }

  /** An entry for {@code action} on {@code target} by {@code actor}, with its {@code term}. */
  public static AuditEntry of(UUID target, ModerationAction action, Actor actor, Term term) {
    return new AuditEntry(target, action, actor, term.reason(), term.at(), term.expiry());
  }

  /**
   * The length and reason of an action.
   *
   * @param length how long a ban lasts, or empty for permanent and for other actions
   * @param reason why
   * @param at when it starts
   */
  public record Term(Optional<Duration> length, String reason, Instant at) {

    /** A permanent term, or one for an action that does not expire. */
    public static Term permanent(String reason, Instant at) {
      return new Term(Optional.empty(), reason, at);
    }

    public Term {
      if (length.isPresent()
          && (length.orElseThrow().isNegative() || length.orElseThrow().isZero())) {
        throw new IllegalArgumentException("length must be positive");
      }
    }

    /** When it ends, if it is temporary. */
    public Optional<Instant> expiry() {
      return length.map(at::plus);
    }
  }
}
