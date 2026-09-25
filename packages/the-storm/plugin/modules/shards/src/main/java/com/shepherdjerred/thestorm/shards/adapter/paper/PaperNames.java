package com.shepherdjerred.thestorm.shards.adapter.paper;

import com.shepherdjerred.thestorm.shards.domain.ShardsConfig;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.function.Predicate;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.Server;
import org.bukkit.entity.EntityType;
import org.bukkit.event.entity.CreatureSpawnEvent.SpawnReason;

/**
 * Checks the names in {@code shards.yml} against the running server's registries, so a typo or a
 * pre-1.13 name stops the module at enable instead of silently never matching.
 */
final class PaperNames {

  private PaperNames() {}

  /** Resolves an item material or throws. */
  static Material item(String field, String name) {
    var material = Material.getMaterial(name);
    if (material == null || !material.isItem() || material.isLegacy()) {
      throw new IllegalStateException(field + ": " + name + " is not an item in this version");
    }
    return material;
  }

  /** Every problem with the config's Paper names; empty when all resolve. */
  static List<String> problems(ShardsConfig config, Server server) {
    var problems = new ArrayList<String>();
    check(problems, "item.material", List.of(config.item().material()), PaperNames::isItem);
    check(problems, "drops.mobs", config.drops().mobs().keySet(), PaperNames::isEntityType);
    check(problems, "drops.blocks", config.drops().blocks().keySet(), PaperNames::isBlock);
    check(
        problems,
        "drops.excludedSpawnReasons",
        config.drops().excludedSpawnReasons(),
        PaperNames::isSpawnReason);
    config
        .bonuses()
        .tables()
        .forEach(
            (category, table) ->
                check(problems, "bonuses." + category, table.materials(), PaperNames::isItem));
    for (var altar : config.altars()) {
      var key = NamespacedKey.fromString(altar.world());
      if (key == null || server.getWorld(key) == null) {
        problems.add("altars: world " + altar.world() + " is not loaded");
      }
    }
    return problems;
  }

  private static void check(
      List<String> problems, String field, Iterable<String> names, Predicate<String> valid) {
    for (var name : names) {
      if (!valid.test(name)) {
        problems.add(field + ": unknown name " + name);
      }
    }
  }

  private static boolean isItem(String name) {
    var material = Material.getMaterial(name);
    return material != null && material.isItem() && !material.isLegacy();
  }

  private static boolean isBlock(String name) {
    var material = Material.getMaterial(name);
    return material != null && material.isBlock() && !material.isLegacy();
  }

  private static boolean isEntityType(String name) {
    return Arrays.stream(EntityType.values())
        .anyMatch(type -> type.name().equals(name) && type.isAlive());
  }

  private static boolean isSpawnReason(String name) {
    return Arrays.stream(SpawnReason.values()).anyMatch(reason -> reason.name().equals(name));
  }
}
