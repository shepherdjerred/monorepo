package com.shepherdjerred.thestorm.rwfbots.domain.difficulty;

import java.util.EnumMap;

/**
 * Maps a skill in 0..1 to lever values. Every lever is monotone in skill: more skill never makes a
 * bot worse on any lever. Personalities then shift individual levers by z-scores, where one z is a
 * tenth of the lever's range, and the match shift from the director moves the skill itself.
 */
public final class LeverCurves {

  /** One standard deviation of personality variation, as a fraction of a lever's range. */
  public static final double SIGMA_FRACTION = 0.1;

  private LeverCurves() {}

  /** The lever values of a bot of exactly {@code skill}, 0 weakest to 1 strongest. */
  public static Levers at(double skill) {
    return at(skill, LeverOffsets.NONE);
  }

  /** The lever values of {@code skill} shifted by {@code offsets}, clamped into range. */
  public static Levers at(double skill, LeverOffsets offsets) {
    if (!(skill >= 0 && skill <= 1)) {
      throw new IllegalArgumentException("skill must be 0..1: " + skill);
    }
    var values = new EnumMap<Lever, Double>(Lever.class);
    for (var lever : Lever.values()) {
      var shape = StrictMath.pow(skill, lever.curveExponent());
      // Weighted so the endpoints are exact: skill 0 is the worst value, skill 1 the best.
      var onCurve = lever.worst() * (1 - shape) + lever.best() * shape;
      var sign = lever.lowerIsBetter() ? -1 : 1;
      var shifted = onCurve + sign * offsets.z(lever) * SIGMA_FRACTION * lever.range();
      values.put(lever, lever.clamp(shifted));
    }
    return Levers.of(values);
  }

  /**
   * The levers a bot of base {@code skill} and {@code offsets} plays with when the director shifts
   * every bot's skill by {@code matchShift}.
   */
  public static Levers effective(double skill, LeverOffsets offsets, double matchShift) {
    if (!Double.isFinite(matchShift)) {
      throw new IllegalArgumentException("match shift must be finite");
    }
    return at(Math.clamp(skill + matchShift, 0, 1), offsets);
  }
}
