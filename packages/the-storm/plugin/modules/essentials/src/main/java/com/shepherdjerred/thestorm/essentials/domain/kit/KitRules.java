package com.shepherdjerred.thestorm.essentials.domain.kit;

import com.shepherdjerred.thestorm.core.result.Result;
import java.time.Duration;
import java.time.Instant;
import java.util.Optional;

/** Whether a player may claim a kit. */
public final class KitRules {

  private KitRules() {}

  /**
   * Decides a claim of {@code kit} at {@code now}, given when the player last claimed it. On
   * success the result is the claim time to record.
   */
  public static Result<Instant, KitError> claim(Kit kit, Optional<Instant> lastClaim, Instant now) {
    if (lastClaim.isEmpty()) {
      return Result.ok(now);
    }
    if (kit.once()) {
      return Result.err(new KitError.AlreadyClaimed());
    }
    var availableAt = lastClaim.orElseThrow().plus(kit.cooldown());
    if (now.isBefore(availableAt)) {
      return Result.err(new KitError.OnCooldown(Duration.between(now, availableAt)));
    }
    return Result.ok(now);
  }
}
