package com.shepherdjerred.thestorm.mechanics.domain.creation;

import java.util.Optional;

/** One requirement a new mechanism sign must meet. */
@FunctionalInterface
public interface CreationRule {

  /** Empty when the sign meets this requirement. */
  Optional<Refusal> check(CreationRequest request);
}
