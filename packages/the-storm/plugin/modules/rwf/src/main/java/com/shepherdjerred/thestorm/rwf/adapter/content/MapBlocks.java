package com.shepherdjerred.thestorm.rwf.adapter.content;

import com.shepherdjerred.thestorm.rwf.domain.geometry.BlockPos;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Cuboid;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.function.Function;
import org.bukkit.block.data.BlockData;

/**
 * A map's schematic resolved against the server: every palette entry parsed once into a {@link
 * BlockData} and placed over its region. Pasting and verifying read from here, never from the file.
 */
public final class MapBlocks {

  private final Schematic schematic;
  private final Cuboid region;
  private final List<BlockData> palette;
  private final Map<String, Integer> paletteIndex;

  private MapBlocks(Schematic schematic, Cuboid region, List<BlockData> palette) {
    this.schematic = schematic;
    this.region = region;
    this.palette = List.copyOf(palette);
    var index = new TreeMap<String, Integer>();
    for (var i = 0; i < schematic.palette().size(); i++) {
      index.put(schematic.palette().get(i), i);
    }
    this.paletteIndex = Map.copyOf(index);
  }

  /**
   * Resolves {@code schematic} over {@code region} with {@code parser} (normally {@code
   * Bukkit::createBlockData}). The schematic must fill the region exactly, and every palette entry
   * must be a block state the server knows, written in its canonical form, so what the verifier
   * reads back from the world hashes the same as the file.
   */
  public static MapBlocks resolve(
      Schematic schematic, Cuboid region, Function<String, BlockData> parser) {
    var width = region.max().x() - region.min().x() + 1;
    var height = region.max().y() - region.min().y() + 1;
    var length = region.max().z() - region.min().z() + 1;
    if (schematic.width() != width
        || schematic.height() != height
        || schematic.length() != length) {
      throw new IllegalArgumentException(
          "blocks.schem is "
              + schematic.width()
              + "x"
              + schematic.height()
              + "x"
              + schematic.length()
              + " but the region is "
              + width
              + "x"
              + height
              + "x"
              + length);
    }
    var palette = new ArrayList<BlockData>();
    for (var entry : schematic.palette()) {
      BlockData data;
      try {
        data = parser.apply(entry);
      } catch (IllegalArgumentException e) {
        throw new IllegalArgumentException("unknown block state in palette: " + entry, e);
      }
      if (!data.getAsString().equals(entry)) {
        throw new IllegalArgumentException(
            "palette entry " + entry + " is not canonical; write it as " + data.getAsString());
      }
      palette.add(data);
    }
    return new MapBlocks(schematic, region, palette);
  }

  public Schematic schematic() {
    return schematic;
  }

  public Cuboid region() {
    return region;
  }

  /** The block state at world position {@code pos}, which must lie in the region. */
  public BlockData at(BlockPos pos) {
    return palette.get(
        schematic.paletteIndex(
            pos.x() - region.min().x(), pos.y() - region.min().y(), pos.z() - region.min().z()));
  }

  /** The block state at array position {@code position}. */
  public BlockData atIndex(int position) {
    return palette.get(schematic.paletteIndexAt(position));
  }

  /** The world position of array position {@code position}. */
  public BlockPos positionOf(int position) {
    var x = position % schematic.width();
    var rest = position / schematic.width();
    var z = rest % schematic.length();
    var y = rest / schematic.length();
    return new BlockPos(region.min().x() + x, region.min().y() + y, region.min().z() + z);
  }

  /** The palette index of a canonical block-state string, or -1 if the map never uses it. */
  public int paletteIndexOf(String blockState) {
    return paletteIndex.getOrDefault(blockState, -1);
  }
}
