package com.shepherdjerred.thestorm.mechanics.domain.creation;

import com.shepherdjerred.thestorm.mechanics.domain.grid.Mount;
import java.util.Optional;

/** The sign hangs on the side of a block, which is what a hidden switch is clicked through. */
public final class WallMountedRule implements CreationRule {

  @Override
  public Optional<Refusal> check(CreationRequest request) {
    return request.view().mount() == Mount.WALL
        ? Optional.empty()
        : Optional.of(new Refusal("Put this sign on the side of a block."));
  }
}
