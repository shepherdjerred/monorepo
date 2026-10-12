package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import com.shepherdjerred.thestorm.rwfbots.domain.personality.Archetype;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;

/**
 * How an archetype bends the utilities: multipliers on fighting, holding the playbook's slot,
 * hunting, arming and helping arm, a scale on the decision temperature, whether a planter ignores
 * fights on the way, and the range it fights a kit at.
 *
 * @param engage multiplier on ENGAGE
 * @param slot multiplier on TAKE_SLOT and HOLD_SLOT
 * @param hunt multiplier on HUNT
 * @param arm multiplier on ARM
 * @param helpArm multiplier on HELP_ARM
 * @param temperature multiplier on the decision temperature
 * @param divesPastFights whether a planter holding the plant slot shrugs off fights en route
 */
public record ArchetypeBias(
    double engage,
    double slot,
    double hunt,
    double arm,
    double helpArm,
    double temperature,
    boolean divesPastFights) {

  /** A bow kit's fighting band, in blocks. */
  public static final double LONG_MIN = 15;

  public static final double LONG_MAX = 30;
  public static final double SHORT_MIN = 8;
  public static final double SHORT_MAX = 22;

  public static ArchetypeBias of(Archetype archetype) {
    return switch (archetype) {
      case RUSHER -> new ArchetypeBias(1.25, 0.9, 1.1, 1.0, 0.9, 1.0, false);
      case LURKER -> new ArchetypeBias(0.85, 1.1, 1.0, 0.9, 0.8, 1.0, false);
      case SNIPER -> new ArchetypeBias(1.0, 1.1, 0.7, 0.8, 0.8, 0.9, false);
      case BOMB_DIVER -> new ArchetypeBias(0.9, 1.0, 0.7, 1.3, 1.1, 1.0, true);
      case ANCHOR -> new ArchetypeBias(0.9, 1.2, 0.6, 0.8, 0.9, 0.9, false);
      case FLANKER -> new ArchetypeBias(1.05, 1.1, 1.1, 1.0, 0.9, 1.0, false);
      case SUPPORT -> new ArchetypeBias(0.9, 1.1, 0.8, 0.9, 1.3, 0.9, false);
      case DUELIST -> new ArchetypeBias(1.35, 0.85, 1.2, 0.9, 0.9, 1.0, false);
      case HUNTER -> new ArchetypeBias(1.15, 0.9, 1.5, 0.9, 0.9, 1.0, false);
      case TURTLE -> new ArchetypeBias(0.8, 1.25, 0.6, 0.8, 0.9, 0.85, false);
      case TROLL -> new ArchetypeBias(1.0, 0.9, 1.0, 1.0, 1.0, 1.6, false);
      case TACTICIAN -> new ArchetypeBias(1.0, 1.2, 1.0, 1.0, 1.1, 0.75, false);
    };
  }

  /**
   * The band a bot fights {@code kit} at: bows keep their distance, a sniper's bow keeps the long
   * band whatever the bow, and swords close in.
   */
  public static Range keep(Kit kit, Archetype archetype) {
    if (!kit.hasBow()) {
      return Range.MELEE;
    }
    if (kit == Kit.LONGBOW || archetype == Archetype.SNIPER) {
      return new Range(LONG_MIN, LONG_MAX);
    }
    return new Range(SHORT_MIN, SHORT_MAX);
  }

  /**
   * A fighting distance band.
   *
   * @param min the closest the bot wants an enemy
   * @param max the furthest it will engage
   */
  public record Range(double min, double max) {

    public static final Range MELEE = new Range(0, 4);

    public Range {
      if (!(min >= 0 && max > min)) {
        throw new IllegalArgumentException("bad range " + min + ".." + max);
      }
    }

    public boolean ranged() {
      return min > 0;
    }
  }
}
