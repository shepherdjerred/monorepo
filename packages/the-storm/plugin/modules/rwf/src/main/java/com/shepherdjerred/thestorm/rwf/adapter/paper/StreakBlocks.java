package com.shepherdjerred.thestorm.rwf.adapter.paper;

import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import org.bukkit.block.Block;
import org.bukkit.block.data.BlockData;

/**
 * The blocks killstreak rewards changed (supply crates, napalm's fire), each remembered as it was
 * first so the match reset can put it back. Main thread only.
 */
final class StreakBlocks {

  private static final String CHANGER = "#storm-rwf-killstreak";

  private final PaperContext context;
  private final Map<Block, BlockData> placed = new HashMap<>();

  StreakBlocks(PaperContext context) {
    this.context = context;
  }

  /** Sets {@code block} to {@code data}, remembering what it first was. */
  void place(Block block, BlockData data) {
    placed.putIfAbsent(block, block.getBlockData().clone());
    context.blocks().set(CHANGER, block, data, false);
  }

  /** The match reset: every changed block is put back. */
  void reset() {
    for (var block : Set.copyOf(placed.keySet())) {
      var original = placed.remove(block);
      if (original != null) {
        context.blocks().set(CHANGER, block, original, false);
      }
    }
  }
}
