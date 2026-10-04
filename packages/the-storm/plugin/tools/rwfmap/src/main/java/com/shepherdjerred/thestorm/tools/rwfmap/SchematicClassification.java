package com.shepherdjerred.thestorm.tools.rwfmap;

import com.shepherdjerred.thestorm.rwf.adapter.content.Schematic;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Cuboid;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.map.BlockClassification;
import com.shepherdjerred.thestorm.rwfbots.domain.map.BlockShape;
import com.shepherdjerred.thestorm.rwfbots.domain.map.GridBounds;
import java.util.ArrayList;
import java.util.List;

/**
 * A schematic placed over its region, classified through the {@link BlockTable} once per palette
 * entry. The baker reads shapes by world coordinates; the schematic is addressed relative to the
 * region's lowest corner.
 */
public final class SchematicClassification implements BlockClassification {

  private final Schematic schematic;
  private final GridBounds bounds;
  private final List<BlockTable.Classified> palette;

  private SchematicClassification(
      Schematic schematic, GridBounds bounds, List<BlockTable.Classified> palette) {
    this.schematic = schematic;
    this.bounds = bounds;
    this.palette = List.copyOf(palette);
  }

  /**
   * Classifies every palette entry of {@code schematic}, which must fill {@code region} exactly.
   *
   * @throws UnknownBlockStateException naming {@code mapId} and the state the table does not know
   */
  public static SchematicClassification of(String mapId, Schematic schematic, Cuboid region) {
    var bounds =
        new GridBounds(
            new BlockPos(region.min().x(), region.min().y(), region.min().z()),
            region.max().x() - region.min().x() + 1,
            region.max().y() - region.min().y() + 1,
            region.max().z() - region.min().z() + 1);
    if (schematic.width() != bounds.sizeX()
        || schematic.height() != bounds.sizeY()
        || schematic.length() != bounds.sizeZ()) {
      throw new IllegalArgumentException(
          "map " + mapId + ": blocks.schem does not fill the region in map.yml");
    }
    var palette = new ArrayList<BlockTable.Classified>();
    for (var entry : schematic.palette()) {
      try {
        palette.add(BlockTable.classify(entry));
      } catch (UnknownBlockStateException e) {
        throw new UnknownBlockStateException("map " + mapId + ": " + e.getMessage());
      }
    }
    return new SchematicClassification(schematic, bounds, palette);
  }

  /** The classification of each palette entry, by palette index. */
  public List<BlockTable.Classified> palette() {
    return palette;
  }

  /** The schematic this classifies. */
  public Schematic schematic() {
    return schematic;
  }

  @Override
  public GridBounds bounds() {
    return bounds;
  }

  @Override
  public BlockShape shape(int x, int y, int z) {
    return classified(x, y, z).shape();
  }

  @Override
  public boolean blocksSight(int x, int y, int z) {
    return classified(x, y, z).blocksSight();
  }

  private BlockTable.Classified classified(int x, int y, int z) {
    var origin = bounds.origin();
    return palette.get(schematic.paletteIndex(x - origin.x(), y - origin.y(), z - origin.z()));
  }
}
