package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.rwf.adapter.content.MapBlocks;
import com.shepherdjerred.thestorm.rwf.adapter.content.Schematic;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Cuboid;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import java.util.function.Consumer;
import org.bukkit.ChunkSnapshot;
import org.bukkit.Location;
import org.bukkit.World;

/**
 * A schematic's blocks standing in the world: a map's or the lobby's. Its chunks are held loaded,
 * its terrain is verified by hashing chunk snapshots on the compute pool and pasted in batches when
 * it differs. Main thread only; the hashing runs off it.
 */
final class Terrain {

  /** The most blocks placed in one tick while pasting. */
  static final int PASTE_BATCH = 20_000;

  /**
   * What stands in the world.
   *
   * @param id the map id, or the lobby's, for logs
   * @param blocks the schematic over its region
   * @param blocksSha256 the hash the region's blocks must have
   */
  record Source(String id, MapBlocks blocks, String blocksSha256) {}

  private final PaperContext context;
  private final Source source;
  private final ChunkHolder chunks;
  private final List<int[]> held = new ArrayList<>();
  private boolean busy;
  private boolean ready;

  Terrain(PaperContext context, Source source, ChunkHolder chunks) {
    this.context = context;
    this.source = source;
    this.chunks = chunks;
  }

  String id() {
    return source.id();
  }

  MapBlocks blocks() {
    return source.blocks();
  }

  Cuboid region() {
    return source.blocks().region();
  }

  private World world() {
    return context.world();
  }

  /** Whether the terrain is pasted and verified. */
  boolean ready() {
    return ready;
  }

  /** Whether a paste or a verification is under way. */
  boolean busy() {
    return busy;
  }

  boolean contains(Location location) {
    return location.getWorld().equals(world()) && region().contains(Places.vec(location));
  }

  /** The chunks the region spans, as {@code {x, z}} pairs. */
  List<int[]> chunkCoordinates() {
    var region = region();
    var list = new ArrayList<int[]>();
    for (var x = region.min().x() >> 4; x <= region.max().x() >> 4; x++) {
      for (var z = region.min().z() >> 4; z <= region.max().z() >> 4; z++) {
        list.add(new int[] {x, z});
      }
    }
    return list;
  }

  /**
   * Loads and holds the chunks, then verifies the terrain and pastes it if it differs. {@code done}
   * runs on the main thread with whether the terrain is ready.
   */
  void prepare(Consumer<Boolean> done) {
    if (busy) {
      throw new IllegalStateException(id() + " is already being prepared");
    }
    busy = true;
    var loads =
        chunkCoordinates().stream()
            .map(
                chunk ->
                    world()
                        .getChunkAtAsync(chunk[0], chunk[1], true)
                        .thenAcceptAsync(
                            loaded -> {
                              chunks.hold(world(), chunk[0], chunk[1]);
                              held.add(chunk);
                            },
                            context.mainThread()))
            .toArray(CompletableFuture[]::new);
    var _ =
        CompletableFuture.allOf(loads)
            .whenCompleteAsync(
                (ignored, failure) -> {
                  busy = false;
                  if (failure != null) {
                    context.logger().error("Could not load chunks of {}", id(), failure);
                    done.accept(false);
                    return;
                  }
                  verifyAndRepair(done);
                },
                context.mainThread());
  }

  /** Verifies the terrain and pastes it when it differs; {@code done} gets whether it is ready. */
  void verifyAndRepair(Consumer<Boolean> done) {
    verifyAndRepair(() -> {}, done);
  }

  /**
   * Verifies the terrain and pastes it when it differs, running {@code beforePaste} first; {@code
   * done} gets whether it is ready.
   */
  void verifyAndRepair(Runnable beforePaste, Consumer<Boolean> done) {
    if (busy) {
      throw new IllegalStateException(id() + " is already busy");
    }
    ready = false;
    verify(
        matches -> {
          if (matches.isEmpty()) {
            done.accept(false);
          } else if (matches.orElseThrow()) {
            ready = true;
            done.accept(true);
          } else {
            context.logger().warn("{} differs from its schematic; pasting it", id());
            beforePaste.run();
            paste(
                () -> {
                  ready = true;
                  done.accept(true);
                });
          }
        });
  }

  /**
   * Hashes the region's blocks (snapshots taken here, hashed on the compute pool) against the
   * declared hash. {@code done} gets empty when the hash could not be computed.
   */
  void verify(Consumer<Optional<Boolean>> done) {
    busy = true;
    var region = region();
    var snapshots = new ArrayList<ChunkSnapshot>();
    var coordinates = chunkCoordinates();
    for (var chunk : coordinates) {
      snapshots.add(world().getChunkAt(chunk[0], chunk[1]).getChunkSnapshot(false, false, false));
    }
    var blocks = source.blocks();
    var expected = source.blocksSha256();
    var _ =
        context
            .compute()
            .submit(() -> hash(region, coordinates, snapshots, blocks).equals(expected))
            .whenCompleteAsync(
                (matches, failure) -> {
                  busy = false;
                  if (failure != null) {
                    context.logger().error("Could not verify {}", id(), failure);
                    done.accept(Optional.empty());
                  } else {
                    done.accept(Optional.of(matches));
                  }
                },
                context.mainThread());
  }

  /** The hash of what stands in {@code region} now, in the schematic's own form. */
  static String hash(
      Cuboid region, List<int[]> coordinates, List<ChunkSnapshot> snapshots, MapBlocks blocks) {
    var schematic = blocks.schematic();
    var indices = new int[schematic.blockCount()];
    var position = 0;
    for (var y = region.min().y(); y <= region.max().y(); y++) {
      for (var z = region.min().z(); z <= region.max().z(); z++) {
        for (var x = region.min().x(); x <= region.max().x(); x++) {
          var snapshot = snapshots.get(chunkIndex(coordinates, x >> 4, z >> 4));
          var state = snapshot.getBlockData(x & 15, y, z & 15).getAsString();
          var index = blocks.paletteIndexOf(state);
          if (index < 0) {
            return "";
          }
          indices[position++] = index;
        }
      }
    }
    return Schematic.sha256(schematic.size(), schematic.palette(), indices);
  }

  private static int chunkIndex(List<int[]> coordinates, int x, int z) {
    for (var i = 0; i < coordinates.size(); i++) {
      if (coordinates.get(i)[0] == x && coordinates.get(i)[1] == z) {
        return i;
      }
    }
    throw new IllegalStateException("chunk " + x + "," + z + " is outside the region");
  }

  /** Pastes the whole schematic, {@link #PASTE_BATCH} blocks a tick; {@code done} runs after. */
  void paste(Runnable done) {
    busy = true;
    pasteFrom(0, done);
  }

  private void pasteFrom(int start, Runnable done) {
    var blocks = source.blocks();
    var end = Math.min(blocks.schematic().blockCount(), start + PASTE_BATCH);
    for (var i = start; i < end; i++) {
      Places.block(world(), blocks.positionOf(i)).setBlockData(blocks.atIndex(i), false);
    }
    if (end < blocks.schematic().blockCount()) {
      context.scheduler().runOnMainThread(() -> pasteFrom(end, done));
      return;
    }
    busy = false;
    done.run();
  }

  /** Lets the chunks go; the module is disabling. */
  void release() {
    for (var chunk : held) {
      chunks.release(world(), chunk[0], chunk[1]);
    }
    held.clear();
  }
}
