package com.shepherdjerred.thestorm.creative.adapter.paper;

import com.shepherdjerred.thestorm.creative.domain.PlotBounds;
import com.shepherdjerred.thestorm.creative.domain.PlotFootprint;
import com.shepherdjerred.thestorm.creative.domain.PlotGrid;
import com.shepherdjerred.thestorm.creative.domain.PlotSurface;
import io.papermc.paper.registry.RegistryAccess;
import io.papermc.paper.registry.RegistryKey;
import java.util.HashMap;
import java.util.Map;
import java.util.Objects;
import net.kyori.adventure.key.Key;
import org.bukkit.Bukkit;
import org.bukkit.World;
import org.bukkit.block.Biome;
import org.bukkit.block.data.BlockData;

/** Writes one plot footprint back to the generator plus its stored choices. Roads are untouched. */
final class PlotRestore {

  private PlotRestore() {}

  static void write(World world, PlotGrid grid, PlotBounds bounds, PlotSurface surface) {
    var paint = new Paint(world, grid, surface, new HashMap<>(), biome(surface));
    int minY = world.getMinHeight();
    int maxY = world.getMaxHeight() - 1;
    for (int x = bounds.minX(); x <= bounds.maxX(); x++) {
      for (int z = bounds.minZ(); z <= bounds.maxZ(); z++) {
        for (int y = minY; y <= maxY; y++) {
          place(paint, x, y, z);
        }
      }
    }
  }

  static boolean matchesTemplate(World world, PlotGrid grid, PlotBounds bounds) {
    var sample = new Sample(world, grid, new HashMap<>());
    return PlotFootprint.matchesTemplate(
        grid,
        bounds,
        new PlotFootprint.Band(world.getMinHeight(), world.getMaxHeight() - 1),
        (x, y, z) -> sampled(sample, x, y, z));
  }

  private record Sample(World world, PlotGrid grid, Map<String, BlockData> blocks) {}

  private record Paint(
      World world,
      PlotGrid grid,
      PlotSurface surface,
      Map<String, BlockData> blocks,
      Biome biome) {}

  private static void place(Paint paint, int x, int y, int z) {
    var state = PlotFootprint.block(paint.grid(), paint.surface(), new PlotFootprint.At(x, y, z));
    var data = paint.blocks().computeIfAbsent(state, Bukkit::createBlockData);
    var block = paint.world().getBlockAt(x, y, z);
    if (!data.matches(block.getBlockData())) {
      block.setBlockData(data, false);
    }
    if (!Objects.equals(paint.world().getBiome(x, y, z), paint.biome())) {
      paint.world().setBiome(x, y, z, paint.biome());
    }
  }

  private static String sampled(Sample sample, int x, int y, int z) {
    var expected = sample.grid().generated(x, y, z);
    var data = sample.blocks().computeIfAbsent(expected, Bukkit::createBlockData);
    var actual = sample.world().getBlockAt(x, y, z).getBlockData();
    return data.matches(actual) ? expected : actual.getAsString();
  }

  private static Biome biome(PlotSurface surface) {
    var id = PlotFootprint.biome(surface);
    var biome = RegistryAccess.registryAccess().getRegistry(RegistryKey.BIOME).get(Key.key(id));
    if (biome == null) {
      throw new IllegalArgumentException("unknown creative biome: " + id);
    }
    return biome;
  }
}
