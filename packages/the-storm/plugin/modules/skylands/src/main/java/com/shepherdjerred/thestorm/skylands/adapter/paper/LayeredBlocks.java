package com.shepherdjerred.thestorm.skylands.adapter.paper;

import java.util.concurrent.ConcurrentHashMap;
import org.bukkit.Bukkit;
import org.bukkit.block.data.BlockData;

/** Block-data definitions are read-only; callers clone before rotation or other mutation. */
final class LayeredBlocks {
  private final ConcurrentHashMap<String, BlockData> data = new ConcurrentHashMap<>();

  BlockData get(String state) {
    return data.computeIfAbsent(state, Bukkit::createBlockData);
  }
}
