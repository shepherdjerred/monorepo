package com.shepherdjerred.thestorm.rwfbots.domain.difficulty;

import java.util.EnumMap;
import java.util.Map;

/**
 * A personality's standing deviations from the skill curve, as z-scores per lever. Positive always
 * means stronger. Levers not mentioned sit on the curve.
 *
 * @param offsets z-scores in -3..3 by lever
 */
public record LeverOffsets(Map<Lever, Double> offsets) {

  public static final LeverOffsets NONE = new LeverOffsets(Map.of());

  /** The largest magnitude an offset may have. */
  public static final double MAX_Z = 3;

  public LeverOffsets {
    var copy = new EnumMap<Lever, Double>(Lever.class);
    offsets.forEach(
        (lever, z) -> {
          if (!(Math.abs(z) <= MAX_Z)) {
            throw new IllegalArgumentException(lever.key() + " offset must be -3..3: " + z);
          }
          copy.put(lever, z);
        });
    offsets = Map.copyOf(copy);
  }

  /** Offsets from configuration keys; an unknown key is an error, never ignored. */
  public static LeverOffsets parse(Map<String, Double> byKey) {
    var map = new EnumMap<Lever, Double>(Lever.class);
    byKey.forEach((key, z) -> map.put(Lever.byKey(key), z));
    return new LeverOffsets(map);
  }

  public double z(Lever lever) {
    return offsets.getOrDefault(lever, 0.0);
  }
}
