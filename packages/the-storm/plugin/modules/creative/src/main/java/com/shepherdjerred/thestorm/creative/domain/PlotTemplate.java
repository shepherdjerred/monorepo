package com.shepherdjerred.thestorm.creative.domain;

import static java.nio.charset.StandardCharsets.UTF_8;

import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.List;

/**
 * The repeated 92 by 92 decoration above the procedural floor, captured by majority vote across the
 * 2016 plots. Roads carry the glowstone crossing, nether brick, stone-brick arches and oak canopy.
 * Plot floors stay grass; player builds are not part of the template.
 *
 * <p>The byte table is {@code CPLT}, version 1, then the cell size, a run count, runs of {@code (y,
 * localX, z0, z1, stateIndex)}, and the state strings those indexes name. A missing cell uses
 * {@link PlotGrid#generated}.
 */
public final class PlotTemplate {

  private static final byte[] MAGIC = {'C', 'P', 'L', 'T'};
  private static final int VERSION = 1;

  private final PlotGrid grid;
  private final int minY;
  private final short[] cells;
  private final List<String> states;

  private PlotTemplate(PlotGrid grid, int minY, int maxY, short[] cells, List<String> states) {
    this.grid = grid;
    this.minY = minY;
    this.cells = cells;
    this.states = states;
    if (maxY < minY) {
      throw new IllegalArgumentException("template height is empty");
    }
  }

  private record Run(int y, int x, int z0, int z1, int state) {}

  /** Reads a template table that must use {@code grid}'s cell size. */
  public static PlotTemplate decode(PlotGrid grid, byte[] bytes) {
    var buffer = ByteBuffer.wrap(bytes);
    int size = header(buffer, grid);
    var parsed = runs(buffer, size);
    var states = states(buffer);
    if (buffer.hasRemaining()) {
      throw new IllegalArgumentException("creative template has trailing bytes");
    }
    return paint(grid, parsed, states);
  }

  private static int header(ByteBuffer buffer, PlotGrid grid) {
    for (byte magic : MAGIC) {
      if (buffer.get() != magic) {
        throw new IllegalArgumentException("creative template has the wrong header");
      }
    }
    int version = buffer.get() & 0xFF;
    if (version != VERSION) {
      throw new IllegalArgumentException("creative template version " + version);
    }
    int size = buffer.getShort() & 0xFFFF;
    if (size != grid.size()) {
      throw new IllegalArgumentException(
          "creative template is a " + size + " grid and this world is " + grid.size());
    }
    return size;
  }

  private static List<Run> runs(ByteBuffer buffer, int size) {
    int count = buffer.getShort() & 0xFFFF;
    var parsed = new ArrayList<Run>(count);
    for (int i = 0; i < count; i++) {
      int y = buffer.get() & 0xFF;
      int x = buffer.get() & 0xFF;
      int z0 = buffer.get() & 0xFF;
      int z1 = buffer.get() & 0xFF;
      int state = buffer.getShort() & 0xFFFF;
      if (x >= size || z0 > z1 || z1 >= size) {
        throw new IllegalArgumentException("creative template run is outside the cell");
      }
      parsed.add(new Run(y, x, z0, z1, state));
    }
    return List.copyOf(parsed);
  }

  private static List<String> states(ByteBuffer buffer) {
    int count = buffer.getShort() & 0xFFFF;
    var states = new ArrayList<String>(count);
    for (int i = 0; i < count; i++) {
      int length = buffer.getShort() & 0xFFFF;
      var raw = new byte[length];
      buffer.get(raw);
      var state = new String(raw, UTF_8);
      if (state.isBlank()) {
        throw new IllegalArgumentException("creative template state is blank");
      }
      states.add(state);
    }
    return List.copyOf(states);
  }

  private static PlotTemplate paint(PlotGrid grid, List<Run> parsed, List<String> states) {
    if (parsed.isEmpty()) {
      return new PlotTemplate(grid, 0, 0, new short[0], states);
    }
    int minY = Integer.MAX_VALUE;
    int maxY = Integer.MIN_VALUE;
    for (var run : parsed) {
      minY = Math.min(minY, run.y);
      maxY = Math.max(maxY, run.y);
    }
    int size = grid.size();
    var cells = new short[(maxY - minY + 1) * size * size];
    for (var run : parsed) {
      if (run.state >= states.size()) {
        throw new IllegalArgumentException("creative template names a missing state");
      }
      for (int z = run.z0; z <= run.z1; z++) {
        cells[((run.y - minY) * size + z) * size + run.x] = (short) (run.state + 1);
      }
    }
    return new PlotTemplate(grid, minY, maxY, cells, states);
  }

  /** Block state at a world position, decoration first and the procedural column otherwise. */
  public String stateAt(int x, int y, int z) {
    int size = grid.size();
    int lx = grid.cellX(x);
    int lz = grid.cellZ(z);
    int layer = y - minY;
    int height = cells.length / (size * size);
    if (layer >= 0 && layer < height) {
      int stored = cells[(layer * size + lz) * size + lx] & 0xFFFF;
      if (stored != 0) {
        return states.get(stored - 1);
      }
    }
    return grid.generated(x, y, z);
  }

  /** States the decoration table names, for the chunk generator's block-data cache. */
  public List<String> states() {
    return states;
  }
}
