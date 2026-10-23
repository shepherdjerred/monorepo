package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import com.shepherdjerred.thestorm.rwfbots.domain.difficulty.Levers;
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

  /** The near edge of a bow kit's fighting band, in blocks. */
  public static final double LONG_MIN = 15;

  public static final double SHORT_MIN = 8;

  /**
   * How far off target, in blocks, a bow shot may land one aim-error deviation out: the far edge of
   * the band is where the bot's aim error spreads this wide. A long bow or a sniper accepts a wider
   * miss, so it opens fire further out at the same skill.
   */
  public static final double SHORT_SPREAD = 1.5;

  public static final double LONG_SPREAD = 2.0;

  /** Even the weakest archer's band reaches this far past its near edge. */
  public static final double BAND_DEPTH = 8;

  /**
   * No archer engages further than this. Production bots launched at a median 15.5 blocks and never
   * beyond 28 while human archers killed from 44; the solver reaches past 100.
   */
  public static final double BAND_CEILING = 55;

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
   * band whatever the bow, and swords close in. A bow's far edge grows with aim: it is the range at
   * which one deviation of {@code levers}' aim error misses by the kit's spread, at least {@link
   * #BAND_DEPTH} past the near edge and no further than the bot notices enemies or {@link
   * #BAND_CEILING}. A weak archer keeps to short shots; a sharp one takes the long ones.
   */
  public static Range keep(Kit kit, Archetype archetype, Levers levers) {
    if (!kit.hasBow()) {
      return Range.MELEE;
    }
    var longBand = kit == Kit.LONGBOW || archetype == Archetype.SNIPER;
    var min = longBand ? LONG_MIN : SHORT_MIN;
    var spread = longBand ? LONG_SPREAD : SHORT_SPREAD;
    var aimed = spread / StrictMath.tan(Math.toRadians(levers.aimErrorDeg()));
    var ceiling = Math.max(min + BAND_DEPTH, Math.min(BAND_CEILING, levers.awarenessRadius()));
    return new Range(min, Math.clamp(aimed, min + BAND_DEPTH, ceiling));
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
