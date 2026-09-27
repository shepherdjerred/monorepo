package com.shepherdjerred.thestorm.mobs.adapter.paper;

import java.util.Collection;
import java.util.List;
import java.util.Random;
import java.util.random.RandomGenerator;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.bukkit.loot.LootContext;
import org.bukkit.loot.Lootable;

/**
 * One extra roll of a mob's own loot table, the only source of a level's extra drops. What the mob
 * wore, held or picked up is never copied.
 */
@FunctionalInterface
interface ExtraLoot {

  Collection<ItemStack> roll(LivingEntity mob, Player killer);

  /** The mob's vanilla loot table, rolled as if {@code killer} made the kill. */
  static ExtraLoot lootTables(RandomGenerator random) {
    return (mob, killer) -> {
      if (!(mob instanceof Lootable lootable)) {
        return List.of();
      }
      var table = lootable.getLootTable();
      if (table == null) {
        return List.of();
      }
      var context = new LootContext.Builder(mob.getLocation()).lootedEntity(mob).killer(killer);
      return table.populateLoot(Random.from(random), context.build());
    };
  }
}
