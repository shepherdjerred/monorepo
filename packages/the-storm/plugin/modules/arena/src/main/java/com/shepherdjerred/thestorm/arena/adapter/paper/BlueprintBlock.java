package com.shepherdjerred.thestorm.arena.adapter.paper;

import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.block.data.BlockData;

/** Author either an exact block-state string or a material's canonical default state. */
final class BlueprintBlock {
  private BlueprintBlock() {}

  static BlockData parse(String value) {
    return value.startsWith("minecraft:")
        ? Bukkit.createBlockData(value)
        : Material.valueOf(value).createBlockData();
  }
}
