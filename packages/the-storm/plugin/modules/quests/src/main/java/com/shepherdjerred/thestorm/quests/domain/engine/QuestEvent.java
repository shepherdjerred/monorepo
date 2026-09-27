package com.shepherdjerred.thestorm.quests.domain.engine;

import com.shepherdjerred.thestorm.quests.domain.model.ItemFacts;
import java.util.Set;

/** Something a player did that objectives may count. */
public sealed interface QuestEvent {

  /** Killed a creature of {@code entity} type. */
  record Killed(String entity) implements QuestEvent {}

  /** Picked up {@code amount} of an item. */
  record Collected(ItemFacts item, int amount) implements QuestEvent {}

  /** Crafted {@code amount} of an item. */
  record Crafted(ItemFacts item, int amount) implements QuestEvent {}

  /** Caught an item with a fishing rod. */
  record Fished(ItemFacts item) implements QuestEvent {}

  /** Broke a block of {@code block} material. */
  record Mined(String block) implements QuestEvent {}

  /** Placed a block of {@code block} material. */
  record Placed(String block) implements QuestEvent {}

  /** Is now inside these regions. */
  record Reached(Set<String> regions) implements QuestEvent {
    public Reached {
      regions = Set.copyOf(regions);
    }
  }

  /** Another module reported progress on a custom objective. */
  record Hook(String hook, int amount) implements QuestEvent {}

  /** Whether nearby players on the same objective share this. */
  default boolean shared() {
    return this instanceof Killed || this instanceof Collected;
  }
}
