package com.shepherdjerred.thestorm.quests.domain.model;

import java.util.Optional;

/**
 * Something a stage asks the player to do. Each objective counts up to {@link #required()}; a stage
 * is done when all of its objectives are. {@code label} replaces the generated description in the
 * journal and sidebar (to keep a surprise, say).
 */
public sealed interface Objective {

  /** The count that completes this objective. */
  int required();

  /** Text shown instead of the generated description, if any. */
  Optional<String> label();

  /**
   * Talk to an NPC. Counts only once every other objective of the stage is done: it is the "report
   * back" step.
   */
  record Talk(String npc, Optional<String> label) implements Objective {
    @Override
    public int required() {
      return 1;
    }
  }

  /** Hand items to an NPC. Partial hand-ins count. */
  record Deliver(String npc, ItemMatch item, int amount, Optional<String> label)
      implements Objective {
    public Deliver {
      positive(amount);
    }

    @Override
    public int required() {
      return amount;
    }
  }

  /** Have items in the inventory at once (they are not taken). */
  record Hold(ItemMatch item, int amount, Optional<String> label) implements Objective {
    public Hold {
      positive(amount);
    }

    @Override
    public int required() {
      return amount;
    }
  }

  /** Pick items up. Shared with nearby players on the same objective. */
  record Collect(ItemMatch item, int amount, Optional<String> label) implements Objective {
    public Collect {
      positive(amount);
    }

    @Override
    public int required() {
      return amount;
    }
  }

  /** Craft items. */
  record Craft(ItemMatch item, int amount, Optional<String> label) implements Objective {
    public Craft {
      positive(amount);
    }

    @Override
    public int required() {
      return amount;
    }
  }

  /** Catch items with a fishing rod; an empty item means any catch. */
  record Fish(Optional<ItemMatch> item, int amount, Optional<String> label) implements Objective {
    public Fish {
      positive(amount);
    }

    @Override
    public int required() {
      return amount;
    }
  }

  /** Break blocks of a material (not ones a player placed recently). */
  record Mine(String block, int amount, Optional<String> label) implements Objective {
    public Mine {
      positive(amount);
    }

    @Override
    public int required() {
      return amount;
    }
  }

  /** Place blocks of a material. */
  record Place(String block, int amount, Optional<String> label) implements Objective {
    public Place {
      positive(amount);
    }

    @Override
    public int required() {
      return amount;
    }
  }

  /** Kill creatures of an entity type. Shared with nearby players on the same objective. */
  record Kill(String entity, int amount, Optional<String> label) implements Objective {
    public Kill {
      positive(amount);
    }

    @Override
    public int required() {
      return amount;
    }
  }

  /** Enter a region. */
  record Reach(String region, Optional<String> label) implements Objective {
    @Override
    public int required() {
      return 1;
    }
  }

  /** Reach a level in a track. */
  record Level(String track, int level, Optional<String> label) implements Objective {
    public Level {
      positive(level);
    }

    @Override
    public int required() {
      return level;
    }
  }

  /** Progress reported by another module through {@code QuestHooks}. */
  record Custom(String hook, int amount, Optional<String> label) implements Objective {
    public Custom {
      positive(amount);
    }

    @Override
    public int required() {
      return amount;
    }
  }

  private static void positive(int amount) {
    if (amount < 1) {
      throw new IllegalArgumentException("an objective needs a count of at least 1: " + amount);
    }
  }
}
