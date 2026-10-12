package com.shepherdjerred.thestorm.discord.app;

import java.util.List;

/**
 * Which progress milestones are posted, from {@code discord.yml}.
 *
 * @param townClaims claim counts that announce a growing town, in rising order
 * @param skillLevelEvery a skill is announced each time its level crosses a multiple of this
 */
public record Milestones(List<Integer> townClaims, int skillLevelEvery) {

  public Milestones {
    townClaims = List.copyOf(townClaims);
    for (var i = 0; i < townClaims.size(); i++) {
      if (townClaims.get(i) < 2 || (i > 0 && townClaims.get(i) <= townClaims.get(i - 1))) {
        throw new IllegalArgumentException(
            "townClaims must rise and start at 2 or more: " + townClaims);
      }
    }
    if (skillLevelEvery < 1) {
      throw new IllegalArgumentException("skillLevelEvery must be at least 1: " + skillLevelEvery);
    }
  }

  /** The milestone a skill crossed going from {@code from} to {@code to}, or 0 for none. */
  public int skillMilestone(int from, int to) {
    var reached = to / skillLevelEvery;
    return reached > from / skillLevelEvery ? reached * skillLevelEvery : 0;
  }
}
