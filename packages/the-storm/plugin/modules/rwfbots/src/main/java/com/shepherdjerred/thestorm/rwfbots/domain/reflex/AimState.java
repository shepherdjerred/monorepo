package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Facing;
import java.util.List;

/**
 * Where the bot is looking and the noise on its aim.
 *
 * @param look the current look direction
 * @param errorYaw the Ornstein-Uhlenbeck yaw error, degrees
 * @param errorPitch the Ornstein-Uhlenbeck pitch error, degrees
 * @param pending the desired facings not yet reacted to, oldest first
 */
public record AimState(Facing look, double errorYaw, double errorPitch, List<Facing> pending) {

  public AimState {
    pending = List.copyOf(pending);
    if (!Double.isFinite(errorYaw) || !Double.isFinite(errorPitch)) {
      throw new IllegalArgumentException("aim error must be finite");
    }
  }

  public static AimState looking(Facing look) {
    return new AimState(look, 0, 0, List.of());
  }
}
