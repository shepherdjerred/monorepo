package com.shepherdjerred.thestorm.essentials.domain.moderation;

import java.time.Instant;
import java.util.Optional;

/**
 * A player's latest ban, replayed from their audit entries in order. A later ban replaces an
 * earlier one; an unban clears it. An expired ban stays recorded here but no longer applies.
 *
 * @param ban the latest ban not lifted by an unban
 */
public record Standing(Optional<Ban> ban) {

  /** A player who was never banned. */
  public static final Standing CLEAN = new Standing(Optional.empty());

  /** The standing after {@code entry}. Kicks leave it unchanged. */
  public Standing apply(AuditEntry entry) {
    return switch (entry.action()) {
      case KICK -> this;
      case BAN ->
          new Standing(
              Optional.of(new Ban(entry.reason(), entry.actor(), entry.at(), entry.expiresAt())));
      case UNBAN -> CLEAN;
    };
  }

  /** The ban in force at {@code now}, if any. */
  public Optional<Ban> activeBan(Instant now) {
    return ban.filter(active -> active.isActive(now));
  }
}
