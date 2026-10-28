package com.shepherdjerred.thestorm.skylands.adapter.paper;

import com.shepherdjerred.thestorm.skylands.domain.LayeredLandscape;
import com.shepherdjerred.thestorm.skylands.domain.SkyBounds;
import com.shepherdjerred.thestorm.skylands.domain.SkyPosition;
import com.shepherdjerred.thestorm.skylands.domain.SkyRandom;
import org.bukkit.Material;
import org.bukkit.block.data.Waterlogged;

/**
 * New-chunk fluid policy: seas, contained ponds and buried lava; no vanilla exposed cave springs.
 */
final class LayeredFluids {
  private final LayeredLandscape landscape;
  private final LayeredBlocks blocks;

  LayeredFluids(LayeredLandscape landscape, LayeredBlocks blocks) {
    this.landscape = landscape;
    this.blocks = blocks;
  }

  void populate(LayeredSlice slice) {
    for (var x = 0; x < 16; x++) {
      for (var z = 0; z < 16; z++)
        cleanColumn(slice, new SkyPosition(slice.x() * 16 + x, 0, slice.z() * 16 + z));
    }
    var x = slice.x() * 16 + 8;
    var z = slice.z() * 16 + 8;
    var column = landscape.column(x, z);
    for (var surface : column.surfaces(36, 225)) {
      var p = new SkyPosition(x, surface, z);
      if (SkyRandom.unit(SkyRandom.hash(p, landscape.seed() + 441)) < .04 && contained(slice, p))
        pond(slice, p);
    }
    buriedLava(slice, column);
  }

  private void cleanColumn(LayeredSlice slice, SkyPosition p) {
    var sea = landscape.column(p.x(), p.z()).ocean();
    for (var y = LayeredLandscape.MIN_Y; y < LayeredLandscape.MAX_Y; y++) {
      var type = slice.region().getType(p.x(), y, p.z());
      var ocean = sea != null && sea.wet() && y >= sea.bottom() && y <= 63;
      if (type == Material.LAVA || (type == Material.WATER && !ocean)) {
        slice.region().setBlockData(p.x(), y, p.z(), blocks.get("minecraft:air"));
      } else if (!ocean
          && !type.isAir()
          && blocks.get(type.getKey().toString()) instanceof Waterlogged) {
        dry(slice, new SkyPosition(p.x(), y, p.z()));
      }
    }
  }

  private static void dry(LayeredSlice slice, SkyPosition p) {
    var data = slice.region().getBlockData(p.x(), p.y(), p.z());
    if (data instanceof Waterlogged wet && wet.isWaterlogged()) {
      wet.setWaterlogged(false);
      slice.region().setBlockData(p.x(), p.y(), p.z(), wet);
    }
  }

  private boolean contained(LayeredSlice slice, SkyPosition p) {
    var bounds = new SkyBounds(p.add(new SkyPosition(-4, -2, -4)), p.add(new SkyPosition(4, 2, 4)));
    if (slice.plan().intersects(bounds)) return false;
    for (var dx = -4; dx <= 4; dx++) {
      for (var dz = -4; dz <= 4; dz++) {
        if (!soil(slice.region().getType(p.x() + dx, p.y() - 1, p.z() + dz))
            || !soil(slice.region().getType(p.x() + dx, p.y() - 2, p.z() + dz))) return false;
      }
    }
    return true;
  }

  private static boolean soil(Material type) {
    return type == Material.STONE
        || type == Material.DIRT
        || type == Material.GRASS_BLOCK
        || type == Material.MYCELIUM
        || type == Material.SNOW_BLOCK
        || type == Material.CLAY;
  }

  private void pond(LayeredSlice slice, SkyPosition p) {
    for (var dx = -3; dx <= 3; dx++) {
      for (var dz = -3; dz <= 3; dz++) {
        if (dx * dx + dz * dz >= 10) continue;
        var q = p.add(new SkyPosition(dx, 0, dz));
        slice.region().setBlockData(q.x(), q.y() - 2, q.z(), blocks.get("minecraft:clay"));
        slice.region().setBlockData(q.x(), q.y() - 1, q.z(), blocks.get("minecraft:water"));
        slice.region().setBlockData(q.x(), q.y(), q.z(), blocks.get("minecraft:air"));
      }
    }
  }

  private void buriedLava(LayeredSlice slice, LayeredLandscape.Column column) {
    var p = new SkyPosition(slice.x() * 16 + 8, 0, slice.z() * 16 + 8);
    if (SkyRandom.unit(SkyRandom.hash(p, landscape.seed() + 2333)) > .2) return;
    for (var y = 45; y < 220; y += 4) {
      var at = p.above(y);
      if (column.solid(y) && rockPocket(slice, at)) {
        slice.region().setBlockData(at.x(), at.y(), at.z(), blocks.get("minecraft:lava"));
        return;
      }
    }
  }

  private boolean rockPocket(LayeredSlice slice, SkyPosition p) {
    if (slice.plan().intersects(new SkyBounds(p, p).expanded(4))) return false;
    for (var dx = -2; dx <= 2; dx++) {
      for (var dz = -2; dz <= 2; dz++) {
        for (var dy = -2; dy <= 2; dy++) {
          if (!soil(slice.region().getType(p.x() + dx, p.y() + dy, p.z() + dz))) return false;
        }
      }
    }
    return true;
  }
}
