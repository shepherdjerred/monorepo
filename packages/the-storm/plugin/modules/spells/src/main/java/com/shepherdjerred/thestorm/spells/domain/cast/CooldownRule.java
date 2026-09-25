package com.shepherdjerred.thestorm.spells.domain.cast;

import com.shepherdjerred.thestorm.spells.domain.Refusal;
import java.util.Optional;

/** A spell waits for its cooldown group, by focus or scroll. */
final class CooldownRule implements CastRule {

  @Override
  public Optional<Refusal> check(CastAttempt attempt) {
    var remaining = attempt.caster().cooldown();
    return remaining.isZero() || remaining.isNegative()
        ? Optional.empty()
        : Optional.of(new Refusal.OnCooldown(remaining));
  }
}
