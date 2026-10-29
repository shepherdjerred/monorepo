package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import com.shepherdjerred.thestorm.rwfbots.domain.difficulty.Levers;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.map.VoxelGrid;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Archetype;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Quirk;
import java.util.Optional;
import java.util.Set;

/**
 * What the reflex layer needs that does not change during a life.
 *
 * @param grid the map, for hit tests and bow lines
 * @param levers the bot's levers
 * @param loadout where the kit's items sit
 * @param habits the body-level habits its personality shows
 * @param nav the map's baked nav artifact, whose certified ground lets a body sprint-jump along a
 *     straight run ({@link RunHop}); a body without one never takes an optional jump
 */
public record ReflexContext(
    VoxelGrid grid, Levers levers, Loadout loadout, Habits habits, Optional<NavArtifact> nav) {

  public ReflexContext {
    // The layers are the same instances, which BitSet.equals answers without comparing bits.
    if (nav.isPresent() && !nav.orElseThrow().grid().equals(grid)) {
      throw new IllegalArgumentException("the reflex grid must be its nav artifact's grid");
    }
  }

  /** A body with no habits. */
  public ReflexContext(VoxelGrid grid, Levers levers, Loadout loadout) {
    this(grid, levers, loadout, Habits.NONE);
  }

  /** A body with {@code habits} and no certified nav. */
  public ReflexContext(VoxelGrid grid, Levers levers, Loadout loadout, Habits habits) {
    this(grid, levers, loadout, habits, Optional.empty());
  }

  /** A body on {@code nav}'s map, with {@code habits}. */
  public ReflexContext(NavArtifact nav, Levers levers, Loadout loadout, Habits habits) {
    this(nav.grid(), levers, loadout, habits, Optional.of(nav));
  }

  /**
   * Body habits from the personality.
   *
   * @param crouchSpam taps sneak while idle and over a fresh kill ({@link Quirk#CROUCH_SPAM})
   * @param eatBelow the effective health under which the bot starts eating when safe; a turtle eats
   *     early
   * @param bunnyHops sprint-jumps along shorter runs and closer to enemies ({@link
   *     Quirk#BUNNY_HOPS}), whatever its technique
   */
  public record Habits(boolean crouchSpam, double eatBelow, boolean bunnyHops) {

    public static final Habits NONE = new Habits(false, Reflex.EAT_BELOW, false);

    /** How much earlier than everyone else a turtle reaches for a golden apple. */
    public static final double TURTLE_EATS_AT = 14;

    public Habits {
      if (!(eatBelow > 0 && eatBelow <= Reflex.EAT_UNTIL)) {
        throw new IllegalArgumentException("eat threshold must be in (0, EAT_UNTIL]: " + eatBelow);
      }
    }

    /** Habits with no bunny hopping. */
    public Habits(boolean crouchSpam, double eatBelow) {
      this(crouchSpam, eatBelow, false);
    }

    public static Habits of(Archetype archetype, Set<Quirk> quirks) {
      return new Habits(
          quirks.contains(Quirk.CROUCH_SPAM),
          archetype == Archetype.TURTLE ? TURTLE_EATS_AT : Reflex.EAT_BELOW,
          quirks.contains(Quirk.BUNNY_HOPS));
    }
  }
}
