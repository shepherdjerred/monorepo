package com.shepherdjerred.thestorm.essentials.adapter.paper;

import com.shepherdjerred.thestorm.core.compute.ComputePool;
import com.shepherdjerred.thestorm.core.schedule.Cancellable;
import com.shepherdjerred.thestorm.core.snapshot.PlayerDataFiles;
import com.shepherdjerred.thestorm.core.world.SealedWorlds;
import com.shepherdjerred.thestorm.essentials.app.store.HomeStore;
import com.shepherdjerred.thestorm.essentials.domain.place.Position;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import net.kyori.adventure.text.Component;
import org.bukkit.World;
import org.jspecify.annotations.Nullable;

/**
 * Copies each saved respawn into the reserved bed home. The bed block does not have to still be
 * there. An existing bed home is left as it is. One player is saved per tick.
 */
final class BedBackfill implements Cancellable {

  private static final Duration STEP = Duration.ofMillis(50);

  private final Sources sources;
  private final List<SavedRespawn.Found> pending = new ArrayList<>();
  private int cursor;
  private int already;
  private int saved;
  private int unavailable;
  private boolean stopped;
  private @Nullable Cancellable later;

  /**
   * What the copy needs.
   *
   * @param runtime server, scheduler and logger
   * @param homes stored homes
   * @param beds in-memory respawn spots
   * @param compute off-main-thread file reading
   * @param sealed worlds whose respawns are not survival beds
   */
  record Sources(
      PaperRuntime runtime,
      HomeStore homes,
      BedHomes beds,
      ComputePool compute,
      SealedWorlds sealed) {}

  BedBackfill(Sources sources) {
    this.sources = sources;
  }

  /** Reads player data, then checks one respawn block per tick. */
  void start() {
    var level = levelDirectory();
    if (level == null) {
      return;
    }
    var files = PlayerDataFiles.locate(level);
    if (files.isEmpty()) {
      sources
          .runtime()
          .logger()
          .warn("No player-data folder under {}; bed homes were not backfilled", level);
      return;
    }
    var directory = files.orElseThrow().directory();
    var _ =
        sources
            .compute()
            .submit(
                () -> {
                  try {
                    return SavedRespawn.readAll(directory);
                  } catch (java.io.IOException failure) {
                    throw new java.io.UncheckedIOException(failure);
                  }
                })
            .whenCompleteAsync(
                (scan, failure) -> {
                  if (stopped) {
                    return;
                  }
                  if (failure != null) {
                    sources
                        .runtime()
                        .logger()
                        .error(Component.text("could not read saved respawns"), failure);
                    return;
                  }
                  begin(scan);
                },
                sources.runtime().scheduler().mainThread());
  }

  /** The server's level directory. Null when this server has no level storage. */
  private @Nullable Path levelDirectory() {
    try {
      return sources.runtime().server().getLevelDirectory();
    } catch (RuntimeException failure) {
      if (failure.getClass().getName().endsWith(".UnimplementedOperationException")) {
        // MockBukkit has no level directory, so there are no player files to read.
        return null;
      }
      throw failure;
    }
  }

  @Override
  public void cancel() {
    stopped = true;
    if (later != null) {
      later.cancel();
    }
  }

  private void begin(SavedRespawn.Scan scan) {
    for (var problem : scan.problems()) {
      sources
          .runtime()
          .logger()
          .error("Could not read respawn from {}", problem.file(), problem.failure());
    }
    sources
        .runtime()
        .onMain(
            sources.homes().bedOwners(),
            "loading saved beds",
            owners -> {
              for (var found : scan.found()) {
                if (owners.contains(found.player())) {
                  already++;
                } else {
                  pending.add(found);
                }
              }
              advance();
            });
  }

  private void advance() {
    if (stopped) {
      return;
    }
    if (cursor >= pending.size()) {
      if (saved > 0 || unavailable > 0) {
        sources
            .runtime()
            .logger()
            .info(
                "Backfilled {} bed homes from player data; {} already had one, {} were in an unloaded or sealed world",
                saved,
                already,
                unavailable);
      }
      return;
    }
    var found = pending.get(cursor);
    cursor++;
    var world = world(found.spot().dimension());
    if (world == null || sources.sealed().isSealed(world)) {
      unavailable++;
      schedule(this::advance);
      return;
    }
    var spot = found.spot();
    var position =
        new Position(world.getName(), spot.x() + 0.5, spot.y(), spot.z() + 0.5, spot.yaw(), 0);
    sources
        .runtime()
        .onMain(
            sources.homes().insertBedIfAbsent(found.player(), position),
            "saving a backfilled bed",
            inserted -> {
              if (inserted) {
                saved++;
                var online = sources.runtime().server().getPlayer(found.player());
                if (online != null) {
                  sources.beds().keep(online, position);
                }
              }
              schedule(this::advance);
            },
            failure -> schedule(this::advance));
  }

  private @Nullable World world(String dimension) {
    for (var world : sources.runtime().server().getWorlds()) {
      if (world.getKey().asString().equals(dimension)) {
        return world;
      }
    }
    return null;
  }

  private void schedule(Runnable task) {
    later = sources.runtime().scheduler().runOnMainThreadLater(STEP, task);
  }
}
