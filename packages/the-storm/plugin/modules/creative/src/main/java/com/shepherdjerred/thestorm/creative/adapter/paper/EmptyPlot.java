package com.shepherdjerred.thestorm.creative.adapter.paper;

import com.shepherdjerred.thestorm.creative.domain.PlotBounds;
import com.shepherdjerred.thestorm.creative.domain.PlotFootprint;
import com.shepherdjerred.thestorm.creative.domain.PlotSurface;
import com.shepherdjerred.thestorm.creative.domain.PlotTemplate;
import io.papermc.paper.registry.RegistryAccess;
import io.papermc.paper.registry.RegistryKey;
import java.util.HashMap;
import java.util.Map;
import java.util.Objects;
import net.kyori.adventure.key.Key;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.World;
import org.bukkit.block.Biome;
import org.bukkit.block.data.BlockData;
import org.bukkit.entity.Player;
import org.bukkit.util.BoundingBox;

/**
 * Writes one plot footprint back to the spawn cell. Roads stay. The band from y 64 through 75 is
 * the captured birch and dead-bush decoration. Every other layer is the generator column.
 */
final class EmptyPlot {

  private EmptyPlot() {}

  static void write(World world, PlotTemplate template, PlotBounds bounds) {
    var paint = new Paint(world, template, new HashMap<>(), plains());
    int minY = world.getMinHeight();
    int maxY = world.getMaxHeight() - 1;
    for (int x = bounds.minX(); x <= bounds.maxX(); x++) {
      for (int z = bounds.minZ(); z <= bounds.maxZ(); z++) {
        for (int y = minY; y <= maxY; y++) {
          place(paint, x, y, z);
        }
      }
    }
    removeResidents(world, bounds);
  }

  /** Drops armor stands, item frames, and other non-players inside the footprint. */
  static void removeResidents(World world, PlotBounds bounds) {
    var box =
        BoundingBox.of(
            new Location(world, bounds.minX(), world.getMinHeight(), bounds.minZ()),
            new Location(world, bounds.maxX(), world.getMaxHeight() - 1, bounds.maxZ()));
    for (var entity : world.getNearbyEntities(box)) {
      if (!(entity instanceof Player)) {
        entity.remove();
      }
    }
  }

  private record Paint(
      World world, PlotTemplate template, Map<String, BlockData> blocks, Biome biome) {}

  private static void place(Paint paint, int x, int y, int z) {
    var state = paint.template().stateAt(x, y, z);
    var data = paint.blocks().computeIfAbsent(state, Bukkit::createBlockData);
    var block = paint.world().getBlockAt(x, y, z);
    if (!data.matches(block.getBlockData())) {
      block.setBlockData(data, false);
    }
    if (!Objects.equals(paint.world().getBiome(x, y, z), paint.biome())) {
      paint.world().setBiome(x, y, z, paint.biome());
    }
  }

  private static Biome plains() {
    var id = PlotFootprint.biome(PlotSurface.DEFAULT);
    var biome = RegistryAccess.registryAccess().getRegistry(RegistryKey.BIOME).get(Key.key(id));
    if (biome == null) {
      throw new IllegalArgumentException("unknown creative biome: " + id);
    }
    return biome;
  }
}
