package com.shepherdjerred.thestorm.shards.adapter.paper;

import com.shepherdjerred.thestorm.shards.domain.AltarLocation;
import com.shepherdjerred.thestorm.shards.domain.ShardsConfig;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;
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
      altarProblem(altar, server).ifPresent(problems::add);
    }
    return problems;
  }

  /**
   * An altar must be the configured block, so a wrong or stale coordinate fails at startup instead
   * of turning some other block into an upgrade altar. Reading the block loads its chunk, which is
   * fine once, at enable.
   */
  private static Optional<String> altarProblem(AltarLocation altar, Server server) {
    var where = altar.world() + " " + altar.x() + " " + altar.y() + " " + altar.z();
    if (!isBlock(altar.material())) {
      return Optional.of("altars: " + altar.material() + " at " + where + " is not a block");
    }
    var key = NamespacedKey.fromString(altar.world());
    var world = key == null ? null : server.getWorld(key);
    if (world == null) {
      return Optional.of("altars: world " + altar.world() + " is not loaded");
    }
    var found = world.getBlockAt(altar.x(), altar.y(), altar.z()).getType().name();
    if (!found.equals(altar.material())) {
      return Optional.of(
          "altars: expected " + altar.material() + " at " + where + " but found " + found);
    }
    return Optional.empty();
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
