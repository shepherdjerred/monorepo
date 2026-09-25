package com.shepherdjerred.thestorm.spells.domain.config;

import java.util.List;
import java.util.regex.Pattern;

/**
 * How a spell's focus looks.
 *
 * @param name the item name, in MiniMessage
 * @param lore the flavor lines, in MiniMessage
 * @param model the {@code item_model} key; a vanilla model (for example {@code
 *     minecraft:blaze_powder}) until the server resource pack ships its own
 */
public record SpellLook(String name, List<String> lore, String model) {

  private static final Pattern KEY = Pattern.compile("[a-z0-9_.-]+:[a-z0-9_./-]+");

  public SpellLook {
    Checks.notBlank("name", name);
    lore = List.copyOf(lore);
    requireModelKey("model", model);
  }

  static void requireModelKey(String field, String model) {
    if (!KEY.matcher(model).matches()) {
      throw new IllegalArgumentException(field + " must be a namespaced key: " + model);
    }
  }
}
