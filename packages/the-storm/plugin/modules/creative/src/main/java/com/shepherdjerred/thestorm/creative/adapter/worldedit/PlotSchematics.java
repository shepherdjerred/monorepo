package com.shepherdjerred.thestorm.creative.adapter.worldedit;

import com.shepherdjerred.thestorm.creative.domain.PlotAccess;
import com.shepherdjerred.thestorm.creative.domain.PlotBounds;
import com.sk89q.worldedit.WorldEdit;
import com.sk89q.worldedit.WorldEditException;
import com.sk89q.worldedit.bukkit.BukkitAdapter;
import com.sk89q.worldedit.extent.clipboard.BlockArrayClipboard;
import com.sk89q.worldedit.extent.clipboard.Clipboard;
import com.sk89q.worldedit.extent.clipboard.io.BuiltInClipboardFormat;
import com.sk89q.worldedit.function.operation.ForwardExtentCopy;
import com.sk89q.worldedit.function.operation.Operations;
import com.sk89q.worldedit.math.BlockVector3;
import com.sk89q.worldedit.regions.CuboidRegion;
import com.sk89q.worldedit.session.ClipboardHolder;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.Optional;
import org.bukkit.World;

/**
 * Copies and pastes one plot column as sponge schematic bytes. Paste refuses a schematic that is
 * not one plot of this world, and one that contains a command block or structure block.
 */
public final class PlotSchematics {

  /** Why a paste was refused before it changed the world. */
  public enum Problem {
    SIZE,
    BANNED
  }

  /** One plot column, from {@code minY} through {@code maxY}. */
  public record Span(World world, PlotBounds bounds, int minY, int maxY) {}

  private PlotSchematics() {}

  /**
   * Pastes {@code bytes} onto {@code span}. Empty means the plot changed. A problem means nothing
   * was written.
   */
  public static Optional<Problem> paste(Span span, byte[] bytes) {
    try {
      return pasted(span, bytes);
    } catch (IOException | WorldEditException failure) {
      throw new IllegalStateException(
          "creative plot " + span.bounds().id().text() + " was not pasted", failure);
    }
  }

  public static byte[] copy(Span span) {
    try {
      return bytes(span);
    } catch (IOException | WorldEditException failure) {
      throw new IllegalStateException(
          "creative plot " + span.bounds().id().text() + " was not copied", failure);
    }
  }

  private static byte[] bytes(Span span) throws WorldEditException, IOException {
    var adapted = BukkitAdapter.adapt(span.world());
    var min = BlockVector3.at(span.bounds().minX(), span.minY(), span.bounds().minZ());
    var max = BlockVector3.at(span.bounds().maxX(), span.maxY(), span.bounds().maxZ());
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

  private static Optional<Problem> pasted(Span span, byte[] bytes)
      throws WorldEditException, IOException {
    try (var reader =
        BuiltInClipboardFormat.SPONGE_V3_SCHEMATIC.getReader(new ByteArrayInputStream(bytes))) {
      var clipboard = reader.read();
      var problem = inspect(clipboard, span.bounds(), span.minY(), span.maxY());
      if (problem.isPresent()) {
        return problem;
      }
      write(span.world(), span.bounds(), span.minY(), clipboard);
      return Optional.empty();
    }
  }

  private static Optional<Problem> inspect(
      Clipboard clipboard, PlotBounds bounds, int minY, int maxY) {
    var region = clipboard.getRegion();
    int width = bounds.maxX() - bounds.minX() + 1;
    int depth = bounds.maxZ() - bounds.minZ() + 1;
    int height = maxY - minY + 1;
    if (region.getWidth() != width || region.getLength() != depth || region.getHeight() != height) {
      return Optional.of(Problem.SIZE);
    }
    for (var pos : region) {
      if (PlotAccess.forbiddenPlacement(clipboard.getBlock(pos).getBlockType().id())) {
        return Optional.of(Problem.BANNED);
      }
    }
    for (var entity : clipboard.getEntities()) {
      var state = entity.getState();
      if (state != null && PlotAccess.forbiddenPlacement(state.getType().id())) {
        return Optional.of(Problem.BANNED);
      }
    }
    return Optional.empty();
  }

  private static void write(World world, PlotBounds bounds, int minY, Clipboard clipboard)
      throws WorldEditException {
    var adapted = BukkitAdapter.adapt(world);
    try (var session = WorldEdit.getInstance().newEditSession(adapted)) {
      var paste =
          new ClipboardHolder(clipboard)
              .createPaste(session)
              .to(BlockVector3.at(bounds.minX(), minY, bounds.minZ()))
              .ignoreAirBlocks(false)
              .copyEntities(true)
              .build();
      Operations.complete(paste);
    }
  }
}
