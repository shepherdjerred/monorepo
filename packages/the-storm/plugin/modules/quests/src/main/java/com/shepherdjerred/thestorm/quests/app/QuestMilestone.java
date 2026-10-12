package com.shepherdjerred.thestorm.quests.app;

import com.shepherdjerred.thestorm.quests.domain.model.Quest;
import java.util.UUID;

/**
 * A saved completion worth telling players outside the game about: the main story or the end of a
 * track's questline. Side, board and hidden quests are not milestones.
 *
 * @param player who completed it
 * @param quest the quest's name
 */
public record QuestMilestone(UUID player, String quest) {

  /** Whether completing {@code quest} is a milestone. */
  public static boolean worthTelling(Quest quest) {
    return switch (quest.category()) {
      case STORY, TRACK -> true;
      case SIDE, DAILY, WEEKLY, HIDDEN -> false;
    };
  }
}
