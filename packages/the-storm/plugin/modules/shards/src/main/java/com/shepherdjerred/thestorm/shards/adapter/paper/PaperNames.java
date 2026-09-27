package com.shepherdjerred.thestorm.shards.adapter.paper;

import com.shepherdjerred.thestorm.shards.domain.AltarLocation;
import com.shepherdjerred.thestorm.shards.domain.ShardsConfig;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executor;
import java.util.function.Function;
import java.util.function.Predicate;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.Server;
import org.bukkit.World;
import org.bukkit.entity.EntityType;
import org.bukkit.event.entity.CreatureSpawnEvent.SpawnReason;
import org.jspecify.annotations.Nullable;

/** Checks configured names immediately, then altar blocks after asynchronous chunk loading. */
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

  /** Every name or world problem available without loading a chunk. */
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
      altarNameProblem(altar, server).ifPresent(problems::add);
    }
    return problems;
  }

  /**
   * An altar must be the configured block. The world and material are checked synchronously, but
   * the block is inspected only after Paper loads the existing chunk asynchronously. All block
   * reads run on the main thread.
   */
  static CompletableFuture<List<String>> altarProblemsAsync(
      ShardsConfig config, Server server, Executor mainThread) {
    return altarProblemsAsync(config, altar -> blockAsync(altar, server, mainThread));
  }

  /** The block loader is supplied by Paper in production and by an in-memory world in tests. */
  static CompletableFuture<List<String>> altarProblemsAsync(
      ShardsConfig config, Function<AltarLocation, CompletableFuture<String>> blocks) {
    CompletableFuture<List<String>> problems = CompletableFuture.completedFuture(List.of());
    for (var altar : config.altars()) {
      problems =
          problems.thenCombine(
              blocks.apply(altar).thenApply(found -> altarProblem(altar, found)),
              (found, problem) -> {
                if (problem.isEmpty()) {
                  return found;
                }
                var next = new ArrayList<>(found);
                next.add(problem.get());
                return List.copyOf(next);
              });
    }
    return problems;
  }

  private static CompletableFuture<String> blockAsync(
      AltarLocation altar, Server server, Executor mainThread) {
    var location = where(altar);
    var loadedWorld = world(server, altar.world());
    if (loadedWorld == null) {
      return CompletableFuture.failedFuture(
          new IllegalStateException("altars: world " + altar.world() + " is not loaded"));
    }
    return loadedWorld
        .getChunkAtAsync(altar.x() >> 4, altar.z() >> 4, false)
        .thenApplyAsync(
            chunk -> {
              if (chunk == null) {
                throw new IllegalStateException(
                    "altars: existing chunk at " + location + " is missing");
              }
              return chunk.getBlock(altar.x() & 15, altar.y(), altar.z() & 15).getType().name();
            },
            mainThread);
  }

  private static Optional<String> altarProblem(AltarLocation altar, String found) {
    return found.equals(altar.material())
        ? Optional.empty()
        : Optional.of(
            "altars: expected " + altar.material() + " at " + where(altar) + " but found " + found);
  }

  private static Optional<String> altarNameProblem(AltarLocation altar, Server server) {
    var where = where(altar);
    if (!isBlock(altar.material())) {
      return Optional.of("altars: " + altar.material() + " at " + where + " is not a block");
    }
    if (world(server, altar.world()) == null) {
      return Optional.of("altars: world " + altar.world() + " is not loaded");
    }
    return Optional.empty();
  }

  private static String where(AltarLocation altar) {
    return altar.world() + " " + altar.x() + " " + altar.y() + " " + altar.z();
  }

  private static @Nullable World world(Server server, String name) {
    var key = NamespacedKey.fromString(name);
    return key == null ? null : server.getWorld(key);
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
