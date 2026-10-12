package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import com.shepherdjerred.thestorm.rwfbots.domain.difficulty.Levers;
import com.shepherdjerred.thestorm.rwfbots.domain.map.VoxelGrid;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Archetype;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Quirk;
import java.util.Set;

/**
 * What the reflex layer needs that does not change during a life.
 *
 * @param grid the map, for hit tests and bow lines
 * @param levers the bot's levers
 * @param loadout where the kit's items sit
 * @param habits the body-level habits its personality shows
 */
public record ReflexContext(VoxelGrid grid, Levers levers, Loadout loadout, Habits habits) {

  /** A body with no habits. */
  public ReflexContext(VoxelGrid grid, Levers levers, Loadout loadout) {
    this(grid, levers, loadout, Habits.NONE);
  }

  /**
   * Body habits from the personality.
   *
   * @param crouchSpam taps sneak while idle and over a fresh kill ({@link Quirk#CROUCH_SPAM})
   * @param eatBelow the effective health under which the bot starts eating when safe; a turtle eats
   *     early
   */
  public record Habits(boolean crouchSpam, double eatBelow) {

    public static final Habits NONE = new Habits(false, Reflex.EAT_BELOW);

    /** How much earlier than everyone else a turtle reaches for a golden apple. */
    public static final double TURTLE_EATS_AT = 14;

    public Habits {
      if (!(eatBelow > 0 && eatBelow <= Reflex.EAT_UNTIL)) {
        throw new IllegalArgumentException("eat threshold must be in (0, EAT_UNTIL]: " + eatBelow);
      }
    }

    public static Habits of(Archetype archetype, Set<Quirk> quirks) {
      return new Habits(
          quirks.contains(Quirk.CROUCH_SPAM),
          archetype == Archetype.TURTLE ? TURTLE_EATS_AT : Reflex.EAT_BELOW);
    }
  }
}
