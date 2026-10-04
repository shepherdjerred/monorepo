package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.rwf.adapter.content.LoadedMap;
import com.shepherdjerred.thestorm.rwf.adapter.content.MapBlocks;
import com.shepherdjerred.thestorm.rwf.adapter.content.Schematic;
import com.shepherdjerred.thestorm.rwf.domain.geometry.BlockPos;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Cuboid;
import com.shepherdjerred.thestorm.rwf.domain.map.MapDefinition;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.function.Consumer;
import org.bukkit.ChunkSnapshot;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.block.data.type.Slab;

/**
 * One map in the world: its chunks held loaded, its terrain pasted from the schematic in batches,
 * verified by hashing chunk snapshots on the compute pool, and cratered and restored during a
 * match. Main thread only; the hashing runs off it.
 */
final class MapWorld {

  /** The most blocks placed in one tick while pasting. */
  static final int PASTE_BATCH = 20_000;

  private final PaperContext context;
  private final LoadedMap map;
  private final ChunkHolder chunks;
  private final Set<BlockPos> cratered = new HashSet<>();
  private final List<int[]> held = new ArrayList<>();
  private boolean busy;
  private boolean ready;

  MapWorld(PaperContext context, LoadedMap map, ChunkHolder chunks) {
    this.context = context;
    this.map = map;
    this.chunks = chunks;
  }

  LoadedMap map() {
    return map;
  }

  String id() {
    return map.id();
  }

  MapDefinition definition() {
    return map.definition();
  }

  MapBlocks blocks() {
    return map.blocks();
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
    return location.getWorld().equals(world())
        && definition().border().contains(Places.vec(location));
  }

  /** The chunks the region spans, as {@code {x, z}} pairs. */
  List<int[]> chunkCoordinates() {
    var border = definition().border();
    var list = new ArrayList<int[]>();
    for (var x = border.min().x() >> 4; x <= border.max().x() >> 4; x++) {
      for (var z = border.min().z() >> 4; z <= border.max().z() >> 4; z++) {
        list.add(new int[] {x, z});
      }
    }
    return list;
  }

  /**
   * Loads and holds the chunks, then verifies the terrain and pastes it if it differs. {@code done}
   * runs on the main thread with whether the map is ready.
   */
  void prepare(Consumer<Boolean> done) {
    if (busy) {
      throw new IllegalStateException("map " + map.id() + " is already being prepared");
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
                    context.logger().error("Could not load chunks of map {}", map.id(), failure);
                    done.accept(false);
                    return;
                  }
                  verifyAndRepair(done);
                },
                context.mainThread());
  }

  /** Verifies the terrain and pastes it when it differs; {@code done} gets whether it is ready. */
  void verifyAndRepair(Consumer<Boolean> done) {
    if (busy) {
      throw new IllegalStateException("map " + map.id() + " is already busy");
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
            context.logger().warn("Map {} differs from its schematic; pasting it", map.id());
            paste(
                () -> {
                  ready = true;
                  done.accept(true);
                });
          }
        });
  }

  /**
   * Hashes the region's blocks (snapshots taken here, hashed on the compute pool) against the map's
   * declared hash. {@code done} gets empty when the hash could not be computed.
   */
  void verify(Consumer<java.util.Optional<Boolean>> done) {
    busy = true;
    var border = definition().border();
    var snapshots = new ArrayList<ChunkSnapshot>();
    var coordinates = chunkCoordinates();
    for (var chunk : coordinates) {
      snapshots.add(world().getChunkAt(chunk[0], chunk[1]).getChunkSnapshot(false, false, false));
    }
    var blocks = map.blocks();
    var expected = definition().blocksSha256();
    var _ =
        context
            .compute()
            .submit(() -> hash(border, coordinates, snapshots, blocks).equals(expected))
            .whenCompleteAsync(
                (matches, failure) -> {
                  busy = false;
                  if (failure != null) {
                    context.logger().error("Could not verify map {}", map.id(), failure);
                    done.accept(java.util.Optional.empty());
                  } else {
                    done.accept(java.util.Optional.of(matches));
                  }
                },
                context.mainThread());
  }

  /** The hash of what stands in {@code border} now, in the schematic's own form. */
  static String hash(
      Cuboid border, List<int[]> coordinates, List<ChunkSnapshot> snapshots, MapBlocks blocks) {
    var schematic = blocks.schematic();
    var indices = new int[schematic.blockCount()];
    var position = 0;
    for (var y = border.min().y(); y <= border.max().y(); y++) {
      for (var z = border.min().z(); z <= border.max().z(); z++) {
        for (var x = border.min().x(); x <= border.max().x(); x++) {
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
    throw new IllegalStateException("chunk " + x + "," + z + " is outside the map");
  }

  /** Pastes the whole schematic, {@link #PASTE_BATCH} blocks a tick; {@code done} runs after. */
  void paste(Runnable done) {
    busy = true;
    cratered.clear();
    pasteFrom(0, done);
  }

  private void pasteFrom(int start, Runnable done) {
    var blocks = map.blocks();
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

  /**
   * Turns solid blocks within {@code radius} of {@code center} to coal and slabs to stone slabs,
   * sparing infested blocks, and remembers them for {@link #revertCraters}.
   */
  void crater(BlockPos center, int radius) {
    var border = definition().border();
    for (var dx = -radius; dx <= radius; dx++) {
      for (var dy = -radius; dy <= radius; dy++) {
        for (var dz = -radius; dz <= radius; dz++) {
          if (dx * dx + dy * dy + dz * dz > radius * radius) {
            continue;
          }
          var pos = center.plus(dx, dy, dz);
          if (border.contains(pos)) {
            craterBlock(pos);
          }
        }
      }
    }
  }

  private void craterBlock(BlockPos pos) {
    var block = Places.block(world(), pos);
    var type = block.getType();
    if (type.name().startsWith("INFESTED_") || !type.isSolid()) {
      return;
    }
    if (block.getBlockData() instanceof Slab slab) {
      var stone = Material.STONE_SLAB.createBlockData();
      if (stone instanceof Slab replacement) {
        replacement.setType(slab.getType());
      }
      block.setBlockData(stone, false);
    } else {
      block.setType(Material.COAL_BLOCK, false);
    }
    cratered.add(pos);
  }

  /** Puts every cratered block back from the schematic. */
  void revertCraters() {
    for (var pos : cratered) {
      Places.block(world(), pos).setBlockData(map.blocks().at(pos), false);
    }
    cratered.clear();
  }

  int crateredBlocks() {
    return cratered.size();
  }

  /** Lets the chunks go; the module is disabling. */
  void release() {
    for (var chunk : held) {
      chunks.release(world(), chunk[0], chunk[1]);
    }
    held.clear();
  }
}
