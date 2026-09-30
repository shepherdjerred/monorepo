package com.shepherdjerred.thestorm.towns.domain.claiming;

import com.shepherdjerred.thestorm.towns.domain.town.Town;
import java.util.List;

/**
 * How many chunks a town may hold: a base every town gets, plus a bonus for its owner's Governor
 * level. The owner's level is the one last seen while they were online, so the limit holds while
 * they are away.
 *
 * @param base chunks any town may hold
 * @param governorBonus the extra chunks at Governor I, II, III, IV and V; one entry per level,
 *     never falling
 */
public record ClaimAllowance(int base, List<Integer> governorBonus) implements ClaimLimits {

  public ClaimAllowance {
    governorBonus = List.copyOf(governorBonus);
    if (base < 1) {
      throw new IllegalArgumentException("base must be at least 1");
    }
    if (governorBonus.size() != Town.MAX_GOVERNOR_LEVEL) {
      throw new IllegalArgumentException(
          "governorBonus needs one entry per Governor level (" + Town.MAX_GOVERNOR_LEVEL + ")");
    }
    var previous = 0;
    for (var bonus : governorBonus) {
      if (bonus < previous) {
        throw new IllegalArgumentException(
            "governorBonus must not be negative or fall as the level rises: " + governorBonus);
      }
      previous = bonus;
    }
  }

  /** The most chunks a town whose owner has Governor {@code level} may hold. */
  public int forLevel(int level) {
    if (level < 0 || level > Town.MAX_GOVERNOR_LEVEL) {
      throw new IllegalArgumentException("no Governor level " + level);
    }
    return level == 0 ? base : base + governorBonus.get(level - 1);
  }

  @Override
  public int maxClaims(Town town) {
    return forLevel(town.governorLevel());
  }
}
