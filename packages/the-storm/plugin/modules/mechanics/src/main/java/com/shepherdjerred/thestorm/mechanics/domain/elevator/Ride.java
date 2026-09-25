package com.shepherdjerred.thestorm.mechanics.domain.elevator;

import com.shepherdjerred.thestorm.mechanics.domain.grid.Pos;
import com.shepherdjerred.thestorm.mechanics.domain.sign.Mechanism;

/**
 * A player asking a lift sign to move them.
 *
 * @param sign the lift sign clicked
 * @param mechanism which lift sign it is
 * @param feet the block the player's feet are in
 */
public record Ride(Pos sign, Mechanism mechanism, Pos feet) {

  public Ride {
    if (!mechanism.isLift()) {
      throw new IllegalArgumentException("not a lift sign: " + mechanism);
    }
  }
}
