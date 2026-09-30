package com.shepherdjerred.thestorm.spells.app;

import java.util.Optional;
import java.util.Set;
import org.bukkit.inventory.ItemStack;

/**
 * Spell scrolls for other modules: quests reward single-use scrolls and teach quest-only spells by
 * granting {@link #learnedPermission}. Main thread only.
 */
public interface SpellScrolls {

  /**
   * The permission that teaches a quest-only spell, for example {@code
   * thestorm.spells.learned.blink}.
   */
  static String learnedPermission(String spellId) {
    return "thestorm.spells.learned." + spellId;
  }

  /** Every spell id. */
  Set<String> spellIds();

  /** {@code amount} scrolls of {@code spellId} (1 up to a stack), or empty for an unknown id. */
  Optional<ItemStack> scroll(String spellId, int amount);

  /** The spell id a focus or scroll carries, or empty for any other item. */
  Optional<String> spellOf(ItemStack item);
}
