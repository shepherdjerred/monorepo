package com.shepherdjerred.thestorm.mechanics.domain.creation;

import com.shepherdjerred.thestorm.mechanics.domain.structure.StructureProblem;
import java.util.Optional;

/** The sign faces north, south, east or west, so the structure has a direction to run in. */
public final class SquareFacingRule implements CreationRule {

  @Override
  public Optional<Refusal> check(CreationRequest request) {
    return request.view().facing().isPresent()
        ? Optional.empty()
        : Optional.of(new Refusal(new StructureProblem.NotSquare().message()));
  }
}
