package com.shepherdjerred.thestorm.creative.adapter.worldedit;

import com.shepherdjerred.thestorm.creative.domain.PlotBounds;
import com.sk89q.worldedit.WorldEdit;
import com.sk89q.worldedit.WorldEditException;
import com.sk89q.worldedit.bukkit.BukkitAdapter;
import com.sk89q.worldedit.extent.clipboard.BlockArrayClipboard;
import com.sk89q.worldedit.extent.clipboard.io.BuiltInClipboardFormat;
import com.sk89q.worldedit.function.operation.ForwardExtentCopy;
import com.sk89q.worldedit.function.operation.Operations;
import com.sk89q.worldedit.math.BlockVector3;
import com.sk89q.worldedit.regions.CuboidRegion;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import org.bukkit.World;

/**
 * Copies one plot column to sponge schematic bytes. The caller writes the file off the main thread.
 */
public final class PlotSchematics {

  private PlotSchematics() {}

  public static byte[] copy(World world, PlotBounds bounds, int minY, int maxY) {
    try {
      return bytes(world, bounds, minY, maxY);
    } catch (IOException | WorldEditException failure) {
      throw new IllegalStateException(
          "creative plot " + bounds.id().text() + " was not copied", failure);
    }
  }

  private static byte[] bytes(World world, PlotBounds bounds, int minY, int maxY)
      throws WorldEditException, IOException {
    var adapted = BukkitAdapter.adapt(world);
    var min = BlockVector3.at(bounds.minX(), minY, bounds.minZ());
    var max = BlockVector3.at(bounds.maxX(), maxY, bounds.maxZ());
    var region = new CuboidRegion(adapted, min, max);
    try (var session = WorldEdit.getInstance().newEditSession(adapted);
        var out = new ByteArrayOutputStream()) {
      var clipboard = new BlockArrayClipboard(region);
      clipboard.setOrigin(min);
      var copy = new ForwardExtentCopy(session, region, clipboard, min);
      copy.setCopyingEntities(true);
      Operations.complete(copy);
      try (var writer = BuiltInClipboardFormat.SPONGE_V3_SCHEMATIC.getWriter(out)) {
        writer.write(clipboard);
      }
      return out.toByteArray();
    }
  }
}
