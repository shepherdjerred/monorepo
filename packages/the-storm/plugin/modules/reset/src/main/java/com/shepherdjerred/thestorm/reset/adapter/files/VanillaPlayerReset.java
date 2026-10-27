package com.shepherdjerred.thestorm.reset.adapter.files;

import com.shepherdjerred.thestorm.core.compute.ComputePool;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import org.bukkit.Server;

/** Deletes vanilla's per-player files after the player has disconnected. */
public final class VanillaPlayerReset {

  private final java.util.function.Supplier<java.util.List<Path>> worlds;
  private final ComputePool compute;

  public VanillaPlayerReset(Server server, ComputePool compute) {
    this(
        compute,
        () ->
            java.util.stream.Stream.concat(
                    server.getWorlds().stream().map(world -> world.getWorldFolder().toPath()),
                    java.util.stream.Stream.of(server.getLevelDirectory()))
                .distinct()
                .toList());
  }

  public VanillaPlayerReset(ComputePool compute, java.util.List<Path> worlds) {
    this(compute, () -> worlds);
  }

  private VanillaPlayerReset(
      ComputePool compute, java.util.function.Supplier<java.util.List<Path>> worlds) {
    this.compute = compute;
    this.worlds = worlds;
  }

  /** Captures world paths on the main thread, then removes files off-main. */
  public CompletableFuture<Void> erase(UUID player) {
    return erase(worlds.get(), player);
  }

  /** Removes the target's files from the supplied world directories. */
  public CompletableFuture<Void> erase(java.util.List<Path> worlds, UUID player) {
    var paths = java.util.List.copyOf(worlds);
    return compute.submit(
        () -> {
          for (var world : paths) {
            erase(world, player);
          }
          return null;
        });
  }

  /** Checks on the compute pool that no vanilla player files remain. */
  public CompletableFuture<Boolean> missing(UUID player) {
    var paths = java.util.List.copyOf(worlds.get());
    return compute.submit(
        () -> {
          for (var world : paths) {
            if (!missing(world, player)) {
              return false;
            }
          }
          return true;
        });
  }

  private static boolean missing(Path world, UUID player) {
    return !Files.exists(world.resolve(Path.of("players", "data", player + ".dat")))
        && !Files.exists(world.resolve(Path.of("playerdata", player + ".dat")))
        && !Files.exists(world.resolve(Path.of("stats", player + ".json")))
        && !Files.exists(world.resolve(Path.of("advancements", player + ".json")));
  }

  private static void erase(Path world, UUID player) {
    erase(world.resolve(Path.of("players", "data")), player, ".dat");
    erase(world.resolve("playerdata"), player, ".dat");
    erase(world.resolve("stats"), player, ".json");
    erase(world.resolve("advancements"), player, ".json");
  }

  private static void erase(Path directory, UUID player, String extension) {
    delete(directory.resolve(player + extension));
    if (extension.equals(".dat")) {
      delete(directory.resolve(player + extension + "_old"));
    }
  }

  private static void delete(Path file) {
    try {
      Files.deleteIfExists(file);
    } catch (IOException e) {
      throw new UncheckedIOException("Could not delete player file " + file, e);
    }
  }
}
