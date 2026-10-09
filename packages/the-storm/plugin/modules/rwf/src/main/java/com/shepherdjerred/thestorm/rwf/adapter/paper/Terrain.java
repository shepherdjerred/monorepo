package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.rwf.adapter.content.MapBlocks;
import com.shepherdjerred.thestorm.rwf.adapter.content.Schematic;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Cuboid;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
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
  static final int PASTE_BATCH = 2_000;

  static final int CHUNK_LOAD_BATCH = 4;
  static final int SNAPSHOT_BATCH = 2;

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
  private boolean released;

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

  int heldChunks() {
    return held.size();
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
    if (released) throw new IllegalStateException(id() + " terrain was released");
    if (busy) {
      throw new IllegalStateException(id() + " is already being prepared");
    }
    busy = true;
    loadChunks(chunkCoordinates(), 0, done);
  }

  private void loadChunks(List<int[]> coordinates, int start, Consumer<Boolean> done) {
    if (released) {
      busy = false;
      done.accept(false);
      return;
    }
    var end = Math.min(coordinates.size(), start + CHUNK_LOAD_BATCH);
    var loads =
        coordinates.subList(start, end).stream()
            .map(
                chunk ->
                    world()
                        .getChunkAtAsync(chunk[0], chunk[1], true)
                        .thenAcceptAsync(
                            loaded -> {
                              if (released) return;
                              chunks.hold(world(), chunk[0], chunk[1]);
                              held.add(chunk);
                            },
                            context.mainThread()))
            .toArray(CompletableFuture[]::new);
    var _ =
        CompletableFuture.allOf(loads)
            .whenCompleteAsync(
                (ignored, failure) -> {
                  if (released) {
                    busy = false;
                    done.accept(false);
                    return;
                  }
                  if (failure != null) {
                    busy = false;
                    context.logger().error("Could not load chunks of {}", id(), failure);
                    done.accept(false);
                    return;
                  }
                  if (end < coordinates.size()) {
                    var _ =
                        context
                            .scheduler()
                            .runOnMainThreadLater(
                                Duration.ofMillis(50), () -> loadChunks(coordinates, end, done));
                  } else {
                    busy = false;
                    verifyAndRepair(done);
                  }
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
    if (released) {
      done.accept(false);
      return;
    }
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
                  ready = !released;
                  done.accept(!released);
                });
          }
        });
  }

  /**
   * Hashes the region's blocks (snapshots taken here, hashed on the compute pool) against the
   * declared hash. {@code done} gets empty when the hash could not be computed.
   */
  void verify(Consumer<Optional<Boolean>> done) {
    if (released) {
      done.accept(Optional.empty());
      return;
    }
    if (busy) throw new IllegalStateException(id() + " is already busy");
    busy = true;
    var coordinates = chunkCoordinates();
    capture(coordinates, new ArrayList<>(coordinates.size()), done);
  }

  private void capture(
      List<int[]> coordinates, List<ChunkSnapshot> snapshots, Consumer<Optional<Boolean>> done) {
    if (released) {
      busy = false;
      done.accept(Optional.empty());
      return;
    }
    var end = Math.min(coordinates.size(), snapshots.size() + SNAPSHOT_BATCH);
    for (var i = snapshots.size(); i < end; i++) {
      var chunk = coordinates.get(i);
      snapshots.add(world().getChunkAt(chunk[0], chunk[1]).getChunkSnapshot(false, false, false));
    }
    if (end < coordinates.size()) {
      var _ =
          context
              .scheduler()
              .runOnMainThreadLater(
                  Duration.ofMillis(50), () -> capture(coordinates, snapshots, done));
      return;
    }
    var region = region();
    var blocks = source.blocks();
    var expected = source.blocksSha256();
    var _ =
        context
            .compute()
            .submit(() -> hash(region, coordinates, snapshots, blocks).equals(expected))
            .whenCompleteAsync(
                (matches, failure) -> {
                  busy = false;
                  if (released) {
                    done.accept(Optional.empty());
                    return;
                  }
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
    if (coordinates.size() != snapshots.size()) {
      throw new IllegalArgumentException("chunk coordinates and snapshots must have equal sizes");
    }
    var byChunk = new HashMap<Long, ChunkSnapshot>();
    for (var i = 0; i < coordinates.size(); i++) {
      var chunk = coordinates.get(i);
      if (byChunk.put(chunkKey(chunk[0], chunk[1]), snapshots.get(i)) != null) {
        throw new IllegalArgumentException("duplicate chunk coordinates");
      }
    }
    var indices = new int[schematic.blockCount()];
    var position = 0;
    for (var y = region.min().y(); y <= region.max().y(); y++) {
      for (var z = region.min().z(); z <= region.max().z(); z++) {
        for (var x = region.min().x(); x <= region.max().x(); x++) {
          var state = blockState(byChunk, x, y, z);
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

  private static long chunkKey(int x, int z) {
    return ((long) x << 32) | (z & 0xffffffffL);
  }

  private static String blockState(Map<Long, ChunkSnapshot> snapshots, int x, int y, int z) {
    var snapshot = snapshots.get(chunkKey(x >> 4, z >> 4));
    if (snapshot == null) {
      throw new IllegalStateException(
          "chunk " + (x >> 4) + "," + (z >> 4) + " is outside the snapshots");
    }
    return snapshot.getBlockData(x & 15, y, z & 15).getAsString();
  }

  /** Pastes the whole schematic, {@link #PASTE_BATCH} blocks a tick; {@code done} runs after. */
  void paste(Runnable done) {
    busy = true;
    pasteFrom(0, done);
  }

  private void pasteFrom(int start, Runnable done) {
    if (released) {
      busy = false;
      done.run();
      return;
    }
    var blocks = source.blocks();
    var end = Math.min(blocks.schematic().blockCount(), start + PASTE_BATCH);
    var updates = new ArrayList<com.shepherdjerred.thestorm.core.world.BlockChanges.Update>();
    for (var i = start; i < end; i++) {
      var block = Places.block(world(), blocks.positionOf(i));
      var expected = blocks.atIndex(i);
      if (!block.getBlockData().equals(expected)) {
        updates.add(
            new com.shepherdjerred.thestorm.core.world.BlockChanges.Update(
                block, expected, false));
      }
    }
    context.blocks().prepare("#storm-rwf-paste", updates).apply();
    if (end < blocks.schematic().blockCount()) {
      var _ =
          context
              .scheduler()
              .runOnMainThreadLater(Duration.ofMillis(50), () -> pasteFrom(end, done));
      return;
    }
    busy = false;
    done.run();
  }

  /** Lets the chunks go; the module is disabling. */
  void release() {
    released = true;
    ready = false;
    for (var chunk : held) {
      chunks.release(world(), chunk[0], chunk[1]);
    }
    held.clear();
  }
}
