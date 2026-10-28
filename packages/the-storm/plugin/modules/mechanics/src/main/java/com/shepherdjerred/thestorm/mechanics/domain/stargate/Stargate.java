package com.shepherdjerred.thestorm.mechanics.domain.stargate;

import com.shepherdjerred.thestorm.mechanics.domain.grid.Direction;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Pos;
import java.util.UUID;
import org.jspecify.annotations.Nullable;

/** A player-built gate, identified by its sign and its frame in a particular world. */
public record Stargate(
    UUID id,
    UUID networkId,
    String name,
    UUID ownerId,
    UUID worldId,
    Pos sign,
    StargateFrame frame,
    @Nullable String fixedDestination,
    boolean alwaysOpen) {
  public Stargate {
    name = Names.require(name);
    if (fixedDestination != null) fixedDestination = Names.require(fixedDestination);
    if (alwaysOpen && fixedDestination == null)
      throw new IllegalArgumentException("an always-open gate needs a fixed destination");
    if (fixedDestination != null && fixedDestination.equalsIgnoreCase(name))
      throw new IllegalArgumentException("a gate cannot be its own destination");
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
