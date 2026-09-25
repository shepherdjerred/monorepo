package com.shepherdjerred.thestorm.mechanics.adapter.paper;

import com.shepherdjerred.thestorm.core.protection.ProtectedAction;
import com.shepherdjerred.thestorm.mechanics.domain.structure.Target;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import org.bukkit.block.Block;
import org.bukkit.block.BlockFace;
import org.bukkit.block.Sign;
import org.bukkit.block.data.type.WallSign;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockRedstoneEvent;

/**
 * Redstone opens bridges, doors and gates when power arrives and closes them when it leaves. A sign
 * is powered by redstone beside it, or beside the block a wall sign hangs on. Redstone acts with
 * the land rights of the sign's creator, who must also be allowed to use the powering block, so
 * nobody can drive someone else's structure from outside their land.
 */
final class RedstoneListener implements Listener {

  private static final List<BlockFace> FACES =
      List.of(
          BlockFace.NORTH,
          BlockFace.EAST,
          BlockFace.SOUTH,
          BlockFace.WEST,
          BlockFace.UP,
          BlockFace.DOWN);

  private final Kit kit;
  private final Structures structures;

  RedstoneListener(Kit kit, Structures structures) {
    this.kit = kit;
    this.structures = structures;
  }

  @EventHandler
  void onRedstone(BlockRedstoneEvent event) {
    var wasOn = event.getOldCurrent() > 0;
    var isOn = event.getNewCurrent() > 0;
    if (wasOn == isOn) {
      return;
    }
    var source = event.getBlock();
    var signs = poweredSigns(source);
    if (signs.isEmpty()) {
      return;
    }
    var target = isOn ? Target.OPEN : Target.CLOSE;
    for (var block : signs) {
      trigger(source, block, target);
    }
  }

  /**
   * Signs beside {@code source}, and wall signs hanging on the blocks beside it. Only block types
   * of loaded chunks are read, so a redstone change with no sign nearby costs a few lookups.
   */
  private static Set<Block> poweredSigns(Block source) {
    var signs = new LinkedHashSet<Block>();
    for (var face : FACES) {
      var neighbor = source.getRelative(face);
      if (!PaperGrid.loaded(neighbor)) {
        continue;
      }
      if (Signs.isSign(neighbor.getType())) {
        signs.add(neighbor);
        continue;
      }
      for (var side : FACES) {
        var hanging = neighbor.getRelative(side);
        if (PaperGrid.loaded(hanging)
            && Signs.isSign(hanging.getType())
            && hanging.getBlockData() instanceof WallSign wall
            && wall.getFacing() == side) {
          signs.add(hanging);
        }
      }
    }
    return signs;
  }

  private void trigger(Block source, Block block, Target target) {
    if (!(block.getState(false) instanceof Sign sign)) {
      return;
    }
    var view = PaperGrid.view(block, PaperGrid.frontLines(sign));
    var mechanism = view.mechanism();
    if (mechanism.isEmpty() || !mechanism.orElseThrow().isStructure()) {
      return;
    }
    var owner = kit.signs().owner(sign);
    if (!kit.gatekeeper().enabled(mechanism.orElseThrow().feature()) || owner.isEmpty()) {
      return;
    }
    var grid = new PaperGrid(block.getWorld());
    var mayUseSource =
        kit.guard()
            .check(owner.orElseThrow(), ProtectedAction.INTERACT, grid, PaperGrid.pos(source))
            .isAllowed();
    if (mayUseSource) {
      // Nobody to tell if it fails: the structure simply stays as it is.
      structures.toggle(
          owner.orElseThrow(), new Structures.Use(grid, PaperGrid.pos(block), view), target);
    }
  }
}
