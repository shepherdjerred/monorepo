package com.shepherdjerred.thestorm.spells.domain.cast;

import com.shepherdjerred.thestorm.spells.domain.Refusal;
import java.util.Optional;

/** A quest-only spell's focus needs the spell learned. Scrolls do not. */
final class LearnedRule implements CastRule {

  @Override
  public Optional<Refusal> check(CastAttempt attempt) {
    if (!attempt.usesFocus() || !attempt.terms().learned() || attempt.caster().learned()) {
      return Optional.empty();
    }
    return Optional.of(new Refusal.NotLearned());
  }
}
