package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.rwf.adapter.content.MapBlocks;
import java.util.HashMap;
import java.util.Map;
import org.bukkit.block.data.BlockData;

/** Query-local exact state lookup; retained snapshot data is never mutated or handed out. */
final class SnapshotPalette {
  private final MapBlocks blocks;
  private final Map<BlockData, Integer> known = new HashMap<>();

  SnapshotPalette(MapBlocks blocks) {
    this.blocks = blocks;
  }

  int index(BlockData state) {
    var cached = known.get(state);
    if (cached != null) return cached;
    var index = blocks.paletteIndexOf(state.getAsString());
    if (index >= 0 && known.size() < blocks.schematic().palette().size()) known.put(state, index);
    return index;
  }
}
