package com.shepherdjerred.thestorm.arena.domain.wave;

import com.shepherdjerred.thestorm.arena.domain.kit.Slot;
import java.util.Map;
import java.util.Optional;
import java.util.TreeMap;
import java.util.regex.Pattern;

/**
 * A kind of arena mob, defined once in {@code arena/waves.yml} and used by any number of waves.
 *
 * @param type the entity type, in upper case such as {@code ZOMBIE} or {@code CAMEL_HUSK}
 * @param health multiplier on the type's vanilla max health, before wave and player scaling
 * @param damage multiplier on the type's vanilla attack damage, before wave scaling
 * @param speed multiplier on the type's vanilla movement speed
 * @param scale the {@code scale} attribute: 1 is vanilla size, 4 is a giant
 * @param name an optional name shown above the mob
 * @param equipment slot to material, such as {@code MAIN_HAND: IRON_SPEAR}
 * @param rider another archetype that rides this one (cavalry)
 * @param behavior extra AI on top of vanilla
 * @param blast explosion power for {@link Behavior#KAMIKAZE} mobs; 0 for every other behavior
 */
public record MobArchetype(
    String type,
    double health,
    double damage,
    double speed,
    double scale,
    Optional<String> name,
    Map<Slot, String> equipment,
    Optional<String> rider,
    Behavior behavior,
    double blast) {

  private static final Pattern UPPER = Pattern.compile("[A-Z][A-Z0-9_]*");

  /** The smallest and largest values of the vanilla {@code scale} attribute. */
  public static final double MIN_SCALE = 0.0625;

  public static final double MAX_SCALE = 16;

  public MobArchetype {
    if (!UPPER.matcher(type).matches()) {
      throw new IllegalArgumentException("type must look like ZOMBIE: " + type);
    }
    requireRange("health", health, 0.01, 100);
    requireRange("damage", damage, 0, 100);
    requireRange("speed", speed, 0.01, 10);
    requireRange("scale", scale, MIN_SCALE, MAX_SCALE);
    if (name.isPresent() && name.orElseThrow().isBlank()) {
      throw new IllegalArgumentException("name must not be blank; use null for none");
    }
    for (var material : equipment.values()) {
      if (!UPPER.matcher(material).matches()) {
        throw new IllegalArgumentException("equipment must look like IRON_SWORD: " + material);
      }
    }
    if ((behavior == Behavior.KAMIKAZE) != (blast > 0)) {
      throw new IllegalArgumentException("blast must be above 0 for KAMIKAZE mobs and 0 otherwise");
    }
    requireRange("blast", blast, 0, 8);
    equipment = Map.copyOf(new TreeMap<>(equipment));
  }

  private static void requireRange(String what, double value, double low, double high) {
    if (!(value >= low && value <= high)) {
      throw new IllegalArgumentException(what + " must be " + low + " to " + high + ": " + value);
    }
  }
}
