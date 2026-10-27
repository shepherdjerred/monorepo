package com.shepherdjerred.thestorm.creative.adapter.paper;

import com.shepherdjerred.thestorm.creative.domain.PlotBounds;
import com.shepherdjerred.thestorm.creative.domain.PlotGrid;
import com.shepherdjerred.thestorm.creative.domain.PlotTemplate;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.util.HashMap;
import java.util.Map;
import org.bukkit.Bukkit;
import org.bukkit.World;
import org.bukkit.block.data.BlockData;

/**
 * Writes one plot footprint back to the spawn cell. Roads stay. The band from y 64 through 75 is
 * the captured birch and dead-bush decoration. Every other layer is the generator column.
 */
final class EmptyPlot {

  private EmptyPlot() {}

  static PlotTemplate load(PlotGrid grid) {
    try (var in = EmptyPlot.class.getResourceAsStream("/creative-empty-plot.bin")) {
      if (in == null) {
        throw new IllegalStateException("creative empty plot is missing");
      }
      return PlotTemplate.decode(grid, in.readAllBytes());
    } catch (IOException failure) {
      throw new UncheckedIOException(failure);
    }
  }

  static void write(World world, PlotTemplate template, PlotBounds bounds) {
    var paint = new Paint(world, template, new HashMap<>());
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

  private record Paint(World world, PlotTemplate template, Map<String, BlockData> blocks) {}

  private static void place(Paint paint, int x, int y, int z) {
    var state = paint.template().stateAt(x, y, z);
    var data = paint.blocks().computeIfAbsent(state, Bukkit::createBlockData);
    var block = paint.world().getBlockAt(x, y, z);
    if (!data.matches(block.getBlockData())) {
      block.setBlockData(data, false);
    }
  }
}
