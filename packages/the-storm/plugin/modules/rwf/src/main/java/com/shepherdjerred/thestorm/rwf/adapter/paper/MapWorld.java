package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.rwf.adapter.content.LoadedMap;
import com.shepherdjerred.thestorm.rwf.adapter.content.MapBlocks;
import com.shepherdjerred.thestorm.rwf.domain.geometry.BlockPos;
import com.shepherdjerred.thestorm.rwf.domain.map.MapDefinition;
import java.util.HashSet;
import java.util.Set;
import java.util.function.Consumer;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.block.data.type.Slab;

/**
 * One map in the world: its {@link Terrain} (held, verified and pasted from the schematic) and the
 * craters a match blows into it, which are restored afterwards. Main thread only.
 */
final class MapWorld {

  private final PaperContext context;
  private final LoadedMap map;
  private final Terrain terrain;
  private final Set<BlockPos> cratered = new HashSet<>();

  MapWorld(PaperContext context, LoadedMap map, ChunkHolder chunks) {
    this.context = context;
    this.map = map;
    this.terrain =
        new Terrain(
            context,
            new Terrain.Source(map.id(), map.blocks(), map.definition().blocksSha256()),
            chunks);
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

  /** Whether the terrain is pasted and verified. */
  boolean ready() {
    return terrain.ready();
  }

  /** Whether a paste or a verification is under way. */
  boolean busy() {
    return terrain.busy();
  }

  boolean contains(Location location) {
    return terrain.contains(location);
  }

  /** Loads and holds the chunks, then verifies and if need be pastes the terrain. */
  void prepare(Consumer<Boolean> done) {
    terrain.prepare(done);
  }

  /** Verifies the terrain and pastes it when it differs; {@code done} gets whether it is ready. */
  void verifyAndRepair(Consumer<Boolean> done) {
    terrain.verifyAndRepair(cratered::clear, done);
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
    var block = Places.block(context.world(), pos);
    var type = block.getType();
    if (type.name().startsWith("INFESTED_") || !type.isSolid()) {
      return;
    }
    if (block.getBlockData() instanceof Slab slab) {
      var stone = Material.STONE_SLAB.createBlockData();
      if (stone instanceof Slab replacement) {
        replacement.setType(slab.getType());
      }
      context.blocks().set("#storm-rwf-crater", block, stone, false);
    } else {
      context
          .blocks()
          .set("#storm-rwf-crater", block, Material.COAL_BLOCK.createBlockData(), false);
    }
    cratered.add(pos);
  }

  /** Puts every cratered block back from the schematic. */
  void revertCraters() {
    for (var pos : cratered) {
      context
          .blocks()
          .set(
              "#storm-rwf-restore",
              Places.block(context.world(), pos),
              map.blocks().at(pos),
              false);
    }
    cratered.clear();
  }

  int crateredBlocks() {
    return cratered.size();
  }

  /** Lets the chunks go; the module is disabling. */
  void release() {
    terrain.release();
  }
}
