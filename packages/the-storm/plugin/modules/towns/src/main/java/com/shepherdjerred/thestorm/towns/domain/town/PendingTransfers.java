package com.shepherdjerred.thestorm.towns.domain.town;

import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * Handovers an owner asked for and has not yet confirmed. Handing a town over cannot be undone by
 * the old owner, so it takes two commands within a short window. Main thread only.
 */
public final class PendingTransfers {

  private final Duration window;
  private final Map<UUID, Pending> byTown = new HashMap<>();

  private record Pending(PlayerRef target, Instant until) {}

  public PendingTransfers(Duration window) {
    if (window.isNegative() || window.isZero()) {
      throw new IllegalArgumentException("the confirmation window must last a while: " + window);
    }
    this.window = window;
  }

  /** Records that the owner of {@code town} wants to hand it to {@code target}. */
  public void request(UUID town, PlayerRef target, Instant now) {
    byTown.put(town, new Pending(target, now.plus(window)));
  }

  /**
   * The player {@code town}'s owner asked to hand it to, if still in time. The ask stays until
   * {@link #done} or it expires, so a refused confirmation can be retried.
   */
  public Optional<PlayerRef> pending(UUID town, Instant now) {
    var pending = byTown.get(town);
    if (pending != null && !now.isBefore(pending.until())) {
      byTown.remove(town);
      return Optional.empty();
    }
    return pending == null ? Optional.empty() : Optional.of(pending.target());
  }

  /** Forgets {@code town}'s ask, once the handover happened or the town is gone. */
  public void done(UUID town) {
    byTown.remove(town);
  }

  /** How long an owner has to confirm. */
  public Duration window() {
    return window;
  }
}
