package com.shepherdjerred.thestorm.quests.app;

import com.shepherdjerred.thestorm.quests.domain.model.Quest;
import java.util.OptionalInt;
import java.util.UUID;
import java.util.function.Consumer;

/**
 * Saved story, side, and track quests. Daily, weekly, and hidden quests are not counted. Listeners
 * run on the main thread. {@link #counted} is empty while that player's quests are still loading.
 */
public interface QuestCompletions {

  Subscription subscribe(Consumer<Standing> listener);

  /** How many distinct story, side, and track quests {@code player} has saved, once loaded. */
  OptionalInt counted(UUID player);

  /**
   * How many counted quests a player has saved.
   *
   * @param player who
   * @param counted distinct story, side, and track quests saved so far
   */
  record Standing(UUID player, int counted) {

    public Standing {
      if (counted < 0) {
        throw new IllegalArgumentException("counted quests cannot be negative");
      }
    }
  }

  interface Subscription extends AutoCloseable {

    @Override
    void close();
  }

  /** Story, side, and track quests count. Board and hidden quests do not. */
  static boolean counts(Quest.Category category) {
    return switch (category) {
      case STORY, SIDE, TRACK -> true;
      case DAILY, WEEKLY, HIDDEN -> false;
    };
  }
}
