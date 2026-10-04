package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import com.shepherdjerred.thestorm.rwfbots.domain.difficulty.Levers;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Facing;
import java.util.ArrayList;
import java.util.random.RandomGenerator;

/**
 * Moves the look towards a target the way a hand on a mouse does: the target is seen with a
 * reaction delay, the aim wanders around it with Ornstein-Uhlenbeck noise whose standing deviation
 * is the aim error lever, and the view turns no faster than the turn rate lever.
 */
public final class AimController {

  /** The relaxation time of the aim noise, in ticks. */
  public static final double NOISE_TAU_TICKS = 6;

  private AimController() {}

  /**
   * Pushes {@code desired} into the reaction buffer and turns towards the facing that was desired
   * one reaction time ago, offset by fresh aim noise.
   */
  public static AimState aim(
      AimState state, Facing desired, Levers levers, RandomGenerator random) {
    var pending = new ArrayList<>(state.pending());
    pending.add(desired);
    while (pending.size() > levers.reactionTicks()) {
      pending.removeFirst();
    }
    var pursued = pending.getFirst();
    var a = Math.exp(-1 / NOISE_TAU_TICKS);
    var kick = levers.aimErrorDeg() * Math.sqrt(1 - a * a);
    var errorYaw = state.errorYaw() * a + kick * random.nextGaussian();
    var errorPitch = state.errorPitch() * a + kick * random.nextGaussian();
    var noisy = pursued.plus(errorYaw, errorPitch);
    var look = state.look().turnToward(noisy, levers.turnRateDegPerTick());
    return new AimState(look, errorYaw, errorPitch, pending);
  }

  /** Turns towards {@code desired} with no delay or noise, as when walking, under the turn cap. */
  public static AimState steer(AimState state, Facing desired, Levers levers) {
    var look = state.look().turnToward(desired, levers.turnRateDegPerTick());
    return new AimState(look, state.errorYaw(), state.errorPitch(), state.pending());
  }

  /** Drops the reaction buffer, as when the target changes. */
  public static AimState reset(AimState state) {
    return AimState.looking(state.look());
  }
}
