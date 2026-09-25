package com.shepherdjerred.thestorm.spells.domain.config;

import java.util.List;

/**
 * {@code plugins/TheStorm/spells.yml}.
 *
 * @param label the message label, shown as {@code [Spells]:}
 * @param scroll how single-use scrolls look and read
 * @param immuneEntities entity type names no spell ever affects (bosses)
 * @param spells every spell's entry
 */
public record SpellsConfig(
    String label, ScrollConfig scroll, List<String> immuneEntities, Spellbook spells) {

  public SpellsConfig {
    Checks.notBlank("label", label);
    immuneEntities.forEach(name -> Checks.upperName("immuneEntities", name));
    immuneEntities = List.copyOf(immuneEntities);
  }
}
