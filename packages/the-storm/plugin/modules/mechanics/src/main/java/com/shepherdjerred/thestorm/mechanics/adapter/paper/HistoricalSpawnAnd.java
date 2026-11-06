package com.shepherdjerred.thestorm.mechanics.adapter.paper;

import com.shepherdjerred.thestorm.core.protection.Protection;
import java.time.Duration;
import java.util.List;
import org.bukkit.Material;
import org.bukkit.block.Block;
import org.bukkit.block.BlockFace;
import org.bukkit.block.Sign;
import org.bukkit.block.data.FaceAttachable;
import org.bukkit.block.data.type.RedstoneWire;
import org.bukkit.block.data.type.Switch;
import org.bukkit.block.data.type.WallSign;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockRedstoneEvent;

/** Restores the surveyed two-input MC3002 at the historical spawn. */
final class HistoricalSpawnAnd implements Listener {
  private final Kit kit;
  private final Protection protection;

  HistoricalSpawnAnd(Kit kit, Protection protection) {
    this.kit = kit;
    this.protection = protection;
  }

  @EventHandler
  void changed(BlockRedstoneEvent event) {
    var source = event.getBlock();
    if (!source.getWorld().getName().equals("world")
        || source.getY() != 57
        || !((source.getX() == 72 && source.getZ() == -35)
            || (source.getX() == 71 && source.getZ() == -36))) return;
    if ((event.getOldCurrent() > 0) == (event.getNewCurrent() > 0)) return;
    kit.scheduler().runOnMainThreadLater(Duration.ofMillis(50), () -> update(source));
  }

  private void update(Block source) {
    var world = source.getWorld();
    if (kit.sealed(world) || !world.isChunkLoaded(71 >> 4, -35 >> 4)) return;
    var signBlock = world.getBlockAt(71, 57, -35);
    var front = world.getBlockAt(72, 57, -35);
    var left = world.getBlockAt(71, 57, -36);
    var right = world.getBlockAt(71, 57, -34);
    var support = world.getBlockAt(70, 57, -35);
    var output = world.getBlockAt(69, 57, -35);
    if (!(signBlock.getState(false) instanceof Sign sign)
        || !(signBlock.getBlockData() instanceof WallSign wall)
        || wall.getFacing() != BlockFace.EAST
        || !PaperGrid.frontLines(sign).equals(List.of("AND", "[MC3002]", "", ""))
        || !(front.getBlockData() instanceof RedstoneWire first)
        || !(left.getBlockData() instanceof RedstoneWire second)
        || !right.getType().isAir()
        || support.getType() != Material.COBBLESTONE
        || !(output.getBlockData() instanceof Switch lever)
        || output.getType() != Material.LEVER
        || lever.getAttachedFace() != FaceAttachable.AttachedFace.WALL
        || lever.getFacing() != BlockFace.WEST) return;
    for (var block : List.of(signBlock, front, left, right, support, output)) {
      if (!protection.mayOperateServerHistoricalCircuit(block.getLocation())
          || !protection.sameLand(signBlock.getLocation(), block.getLocation())) return;
    }
    var powered = first.getPower() > 0 && second.getPower() > 0;
    if (lever.isPowered() != powered) {
      lever.setPowered(powered);
      output.setBlockData(lever, true);
    }
  }
}
