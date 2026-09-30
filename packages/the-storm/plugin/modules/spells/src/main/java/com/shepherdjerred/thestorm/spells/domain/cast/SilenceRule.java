package com.shepherdjerred.thestorm.spells.domain.cast;

import com.shepherdjerred.thestorm.spells.domain.Refusal;
import java.util.Optional;

/** A silenced player casts nothing, by focus or scroll. */
final class SilenceRule implements CastRule {

  @Override
  public Optional<Refusal> check(CastAttempt attempt) {
    var remaining = attempt.caster().silenced();
    return remaining.isZero() || remaining.isNegative()
        ? Optional.empty()
        : Optional.of(new Refusal.Silenced(remaining));
  }
}
