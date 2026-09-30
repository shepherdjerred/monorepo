package com.shepherdjerred.thestorm.mechanics.domain.tools;

import com.shepherdjerred.thestorm.mechanics.domain.grid.Pos;
import java.util.Comparator;
import java.util.List;

/**
 * Light switches: the nearest lights to the sign go off together if any is on, otherwise on
 * together.
 */
public final class LightSwitch {

  private LightSwitch() {}

  /**
   * A light near a switch.
   *
   * @param pos where it is
   * @param lit whether it is on
   */
  public record Light(Pos pos, boolean lit) {}

  /**
   * What flipping the switch does.
   *
   * @param on whether the lights end up on
   * @param changes the lights to set to {@code on}
   */
  public record Flip(boolean on, List<Pos> changes) {

    public Flip {
      changes = List.copyOf(changes);
    }
  }

  /** Flips the {@code maxLights} lights nearest {@code sign}. */
  public static Flip flip(Pos sign, List<Light> lights, int maxLights) {
    var nearest =
        lights.stream()
            .sorted(
                Comparator.<Light>comparingLong(light -> light.pos().distanceSquared(sign))
                    .thenComparing(Light::pos, Pos.ORDER))
            .limit(maxLights)
            .toList();
    var on = nearest.stream().noneMatch(Light::lit);
    var changes = nearest.stream().filter(light -> light.lit() != on).map(Light::pos).toList();
    return new Flip(on, changes);
  }
}
