package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import com.shepherdjerred.thestorm.rwfbots.domain.difficulty.Levers;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Archetype;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Quirk;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Style;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import java.util.Set;

/**
 * What the think step needs that does not change during a match.
 *
 * @param nav the baked map
 * @param levers the bot's levers
 * @param style the bot's play style
 * @param kit the kit it plays
 * @param archetype its personality's archetype, which bends the utilities and fighting range
 * @param quirks its personality's habits; LATE_TO_EVERYTHING delays its first move
 * @param seed the bot's own seed for this match (match seed mixed with the bot), for route noise
 *     and quirk timing
 */
public record TacticsContext(
    NavArtifact nav,
    Levers levers,
    Style style,
    Kit kit,
    Archetype archetype,
    Set<Quirk> quirks,
    long seed) {

  /** The shortest and longest a late bot waits before its first move, in ticks. */
  public static final int LATE_MIN_TICKS = 40;

  public static final int LATE_SPREAD_TICKS = 60;

  public TacticsContext {
    quirks = Set.copyOf(quirks);
  }

  public boolean hasGapples() {
    return kit.hasGapples();
  }

  public boolean hasRewind() {
    return kit.hasAbility();
  }

  public ArchetypeBias bias() {
    return ArchetypeBias.of(archetype);
  }

  public ArchetypeBias.Range keep() {
    return ArchetypeBias.keep(kit, archetype);
  }

  /** How long the bot stands at the start of its first life: 0, or 2 to 5 s when late. */
  public int lateStartTicks() {
    if (!quirks.contains(Quirk.LATE_TO_EVERYTHING)) {
      return 0;
    }
    return LATE_MIN_TICKS + (int) Math.floorMod(seed, (long) LATE_SPREAD_TICKS);
  }
}
