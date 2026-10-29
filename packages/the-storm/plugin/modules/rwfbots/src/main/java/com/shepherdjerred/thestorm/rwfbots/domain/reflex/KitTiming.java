package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import com.shepherdjerred.thestorm.rwfbots.domain.difficulty.Levers;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Facing;
import java.util.SplittableRandom;
import java.util.random.RandomGenerator;

/**
 * How promptly and how cleanly a bot reaches for a kit item once its moment has come. A polished
 * bot notices the moment within a few ticks, a clumsy one a second or so later, so no use lands on
 * the first possible tick; an aimed throw strays with the bot's aim error. Draws are made only when
 * a moment is there, so a kit with no moment this tick leaves the random stream untouched.
 *
 * @param notice the chance per tick that the bot notices a moment that has come, (0, 1]
 * @param throwError the standard deviation of a throw's stray, degrees
 * @param random the reflex layer's random source
 */
public record KitTiming(double notice, double throwError, RandomGenerator random) {

  /** The chance per tick that the clumsiest bot notices a moment that has come. */
  static final double SLOWEST_NOTICE = 0.06;

  /** The chance per tick that the most polished bot notices it. */
  static final double FASTEST_NOTICE = 0.3;

  /** A throw strays by this share of the bot's aim error: it aims a throw more carefully. */
  static final double THROW_ERROR_SHARE = 0.5;

  public KitTiming {
    if (!(notice > 0 && notice <= 1) || !(throwError >= 0)) {
      throw new IllegalArgumentException("notice must be in (0, 1] and the error non-negative");
    }
  }

  /** A bot that acts on every moment the tick it comes, and throws true: for tests. */
  public static KitTiming prompt() {
    return new KitTiming(1, 0, new SplittableRandom(0));
  }

  /** The timing of a bot with {@code levers}, drawing on {@code random}. */
  public static KitTiming of(Levers levers, RandomGenerator random) {
    return new KitTiming(
        SLOWEST_NOTICE + (FASTEST_NOTICE - SLOWEST_NOTICE) * levers.technique(),
        levers.aimErrorDeg() * THROW_ERROR_SHARE,
        random);
  }

  /** Whether the bot notices, this tick, a moment that has come. */
  public boolean notices() {
    return notice >= 1 || random.nextDouble() < notice;
  }

  /** {@code aim} as the bot's hand throws it: off by a little of its aim error. */
  public Facing stray(Facing aim) {
    if (throwError == 0) {
      return aim;
    }
    var pitch = Math.clamp(aim.pitch() + random.nextGaussian() * throwError, -90, 90);
    return new Facing(aim.yaw() + random.nextGaussian() * throwError, pitch);
  }
}
