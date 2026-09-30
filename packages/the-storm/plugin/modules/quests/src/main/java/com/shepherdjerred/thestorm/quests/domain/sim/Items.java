package com.shepherdjerred.thestorm.quests.domain.sim;

import com.shepherdjerred.thestorm.quests.domain.model.ItemFacts;
import com.shepherdjerred.thestorm.quests.domain.model.ItemMatch;

/** Items that satisfy matches, for scripted play. */
public final class Items {

  private Items() {}

  /** An item stack that has exactly what {@code match} asks for. */
  public static ItemFacts facts(ItemMatch match) {
    return new ItemFacts(match.material(), match.name(), match.enchantments(), match.potion());
  }
}
