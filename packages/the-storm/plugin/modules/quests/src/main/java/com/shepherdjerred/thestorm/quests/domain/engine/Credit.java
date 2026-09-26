package com.shepherdjerred.thestorm.quests.domain.engine;

import com.shepherdjerred.thestorm.quests.domain.model.ItemMatch;
import com.shepherdjerred.thestorm.quests.domain.model.Objective;
import java.util.Optional;

/** How much an event counts toward an objective. */
public final class Credit {

  private Credit() {}

  /** What {@code event} adds to {@code objective}; 0 if it does not count. */
  public static int of(Objective objective, QuestEvent event) {
    return switch (objective) {
      case Objective.Kill(var entity, _, _) -> killed(entity, event);
      case Objective.Collect(var item, _, _) -> collected(item, event);
      case Objective.Craft(var item, _, _) -> crafted(item, event);
      case Objective.Fish(var item, _, _) -> fished(item, event);
      case Objective.Mine(var block, _, _) -> mined(block, event);
      case Objective.Place(var block, _, _) -> placed(block, event);
      case Objective.Reach(var region, _) -> reached(region, event);
      case Objective.Custom(var hook, _, _) -> hooked(hook, event);
      case Objective.Talk _, Objective.Deliver _, Objective.Hold _, Objective.Level _ -> 0;
    };
  }

  private static int one(boolean counts) {
    return counts ? 1 : 0;
  }

  private static int killed(String entity, QuestEvent event) {
    return one(event instanceof QuestEvent.Killed(var killed) && killed.equals(entity));
  }

  private static int collected(ItemMatch item, QuestEvent event) {
    if (event instanceof QuestEvent.Collected(var got, var count) && item.matches(got)) {
      return count;
    }
    return 0;
  }

  private static int crafted(ItemMatch item, QuestEvent event) {
    if (event instanceof QuestEvent.Crafted(var made, var count) && item.matches(made)) {
      return count;
    }
    return 0;
  }

  private static int fished(Optional<ItemMatch> item, QuestEvent event) {
    return one(
        event instanceof QuestEvent.Fished(var caught)
            && item.map(match -> match.matches(caught)).orElse(true));
  }

  private static int mined(String block, QuestEvent event) {
    return one(event instanceof QuestEvent.Mined(var broken) && broken.equals(block));
  }

  private static int placed(String block, QuestEvent event) {
    return one(event instanceof QuestEvent.Placed(var put) && put.equals(block));
  }

  private static int reached(String region, QuestEvent event) {
    return one(event instanceof QuestEvent.Reached(var regions) && regions.contains(region));
  }

  private static int hooked(String hook, QuestEvent event) {
    if (event instanceof QuestEvent.Hook(var reported, var count) && reported.equals(hook)) {
      return count;
    }
    return 0;
  }
}
