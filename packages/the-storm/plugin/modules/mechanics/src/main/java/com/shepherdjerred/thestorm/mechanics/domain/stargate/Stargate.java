package com.shepherdjerred.thestorm.mechanics.domain.stargate;

import com.shepherdjerred.thestorm.mechanics.domain.grid.Direction;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Pos;
import java.util.UUID;

/** A player-built gate, identified by its sign and its frame in a particular world. */
public record Stargate(
    UUID id,
    UUID networkId,
    String name,
    UUID ownerId,
    UUID worldId,
    Pos sign,
    StargateFrame frame) {
  public Stargate {
    name = Names.require(name);
    var facing = frame.across().clockwise().clockwise().clockwise();
    if (frame.controls().stream().noneMatch(control -> control.offset(facing).equals(sign))) {
      throw new IllegalArgumentException("the Stargate sign is not attached to a control block");
    }
  }

  public Direction facing() {
    return frame.across().clockwise().clockwise().clockwise();
  }

  /** The button belongs on the opposite control, on the same face as the sign. */
  public Pos button() {
    var support = sign.offset(facing().opposite());
    return frame.controls().stream()
        .filter(pos -> !pos.equals(support))
        .findFirst()
        .orElseThrow()
        .offset(facing());
  }
}
