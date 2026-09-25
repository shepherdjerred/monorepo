package com.shepherdjerred.thestorm.spells.domain.cast;

import com.shepherdjerred.thestorm.spells.domain.Refusal;
import java.util.Optional;

/** A focus cast must be able to pay its reagents. A scroll is its own cost. */
final class ReagentRule implements CastRule {

  @Override
  public Optional<Refusal> check(CastAttempt attempt) {
    if (!attempt.usesFocus()) {
      return Optional.empty();
    }
    var missing = attempt.terms().cost().shortfall(attempt.caster().held());
    return missing.isEmpty() ? Optional.empty() : Optional.of(new Refusal.MissingReagents(missing));
  }
}
