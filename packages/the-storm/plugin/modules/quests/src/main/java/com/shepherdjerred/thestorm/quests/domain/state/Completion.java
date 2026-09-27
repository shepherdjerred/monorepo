package com.shepherdjerred.thestorm.quests.domain.state;

import java.time.Instant;

/**
 * How often and when a player last completed a quest.
 *
 * @param times how many times it has been completed
 * @param last when it was last completed
 */
public record Completion(int times, Instant last) {

  public Completion {
    if (times < 1) {
      throw new IllegalArgumentException("a completion counts at least once");
    }
  }

  /** One more completion at {@code now}. */
  public Completion again(Instant now) {
    return new Completion(times + 1, now);
  }
}
