package com.shepherdjerred.thestorm.spells.domain.cast;

import com.shepherdjerred.thestorm.spells.domain.Refusal;
import java.util.Optional;

/** A focus needs the caster's Spellcaster level to reach the spell's tier. Scrolls do not. */
final class TierRule implements CastRule {

  @Override
  public Optional<Refusal> check(CastAttempt attempt) {
    var required = attempt.terms().tier();
    var held = attempt.caster().tier();
    if (!attempt.usesFocus() || held >= required) {
      return Optional.empty();
    }
    return Optional.of(new Refusal.TierTooLow(required, held));
  }
}
