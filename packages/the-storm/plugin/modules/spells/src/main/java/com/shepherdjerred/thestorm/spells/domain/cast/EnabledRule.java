package com.shepherdjerred.thestorm.spells.domain.cast;

import com.shepherdjerred.thestorm.spells.domain.Refusal;
import java.util.Optional;

/** A switched-off spell cannot be cast or bound, by focus or scroll. */
final class EnabledRule implements CastRule {

  @Override
  public Optional<Refusal> check(CastAttempt attempt) {
    return attempt.terms().enabled() ? Optional.empty() : Optional.of(new Refusal.Disabled());
  }
}
