package com.shepherdjerred.thestorm.spells.domain.cast;

import com.shepherdjerred.thestorm.spells.domain.Refusal;
import java.util.Optional;

/** One gate a cast must pass. */
@FunctionalInterface
public interface CastRule {

  /** Why {@code attempt} is refused, or empty when this rule allows it. */
  Optional<Refusal> check(CastAttempt attempt);
}
