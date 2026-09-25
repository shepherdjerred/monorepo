package com.shepherdjerred.thestorm.mechanics.adapter.paper;

import com.shepherdjerred.thestorm.core.protection.Decision;
import com.shepherdjerred.thestorm.core.protection.ProtectedAction;
import com.shepherdjerred.thestorm.mechanics.domain.sign.Feature;
import com.shepherdjerred.thestorm.mechanics.domain.sign.Mechanism;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import org.bukkit.Material;
import org.bukkit.Tag;
import org.bukkit.block.Block;
import org.bukkit.block.BlockFace;
import org.bukkit.block.Sign;
import org.bukkit.block.data.type.Switch;
import org.bukkit.block.data.type.WallSign;
import org.bukkit.entity.Player;
import org.bukkit.event.Event;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.Action;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.inventory.EquipmentSlot;

/**
 * Hidden switches: right-clicking a block that has an {@code [X]} sign on its far side flips the
 * levers and presses the buttons beside that sign.
 */
final class HiddenSwitchListener implements Listener {

  private static final List<BlockFace> FACES =
      List.of(
          BlockFace.NORTH,
          BlockFace.EAST,
          BlockFace.SOUTH,
          BlockFace.WEST,
          BlockFace.UP,
          BlockFace.DOWN);

  /** How long a pressed button stays down, as in vanilla. */
  private static final Duration STONE_PRESS = Duration.ofSeconds(1);

  private static final Duration WOODEN_PRESS = Duration.ofMillis(1500);

  private final Kit kit;

  HiddenSwitchListener(Kit kit) {
    this.kit = kit;
  }

  @EventHandler(priority = EventPriority.HIGH)
  void onInteract(PlayerInteractEvent event) {
    var clicked = event.getClickedBlock();
    if (event.getAction() != Action.RIGHT_CLICK_BLOCK
        || event.getHand() != EquipmentSlot.HAND
        || clicked == null
        || event.useInteractedBlock() == Event.Result.DENY
        || Signs.isSign(clicked.getType())) {
      return;
    }
    var behind = event.getBlockFace().getOppositeFace();
    var signBlock = clicked.getRelative(behind);
    if (!(signBlock.getBlockData() instanceof WallSign wall)
        || wall.getFacing() != behind
        || !(signBlock.getState(false) instanceof Sign sign)
        || !isHiddenSwitch(signBlock, sign)) {
      return;
    }
    event.setUseInteractedBlock(Event.Result.DENY);
    event.setUseItemInHand(Event.Result.DENY);
    var player = event.getPlayer();
    if (kit.admit(player, Feature.HIDDEN_SWITCH, sign).isEmpty()) {
      return;
    }
    var grid = new PaperGrid(clicked.getWorld());
    var entry =
        kit.guard()
            .check(player.getUniqueId(), ProtectedAction.INTERACT, grid, PaperGrid.pos(clicked));
    if (entry instanceof Decision.Denied(var reason)) {
      Replies.error(player, Feature.HIDDEN_SWITCH, reason);
      return;
    }
    flip(player, grid, switchesBeside(signBlock, clicked));
  }

  private static boolean isHiddenSwitch(Block block, Sign sign) {
    return PaperGrid.view(block, PaperGrid.frontLines(sign))
        .mechanism()
        .filter(mechanism -> mechanism == Mechanism.HIDDEN_SWITCH)
        .isPresent();
  }

  private static List<Block> switchesBeside(Block sign, Block wall) {
    var switches = new ArrayList<Block>();
    for (var face : FACES) {
      var neighbor = sign.getRelative(face);
      if (!neighbor.equals(wall) && neighbor.getBlockData() instanceof Switch) {
        switches.add(neighbor);
      }
    }
    return switches;
  }

  private void flip(Player player, PaperGrid grid, List<Block> switches) {
    var flipped = 0;
    for (var block : switches) {
      var allowed =
          kit.guard()
              .check(player.getUniqueId(), ProtectedAction.INTERACT, grid, PaperGrid.pos(block))
              .isAllowed();
      if (allowed && press(block)) {
        flipped++;
      }
    }
    if (flipped == 0) {
      Replies.error(player, Feature.HIDDEN_SWITCH, "No lever or button beside the switch sign.");
    }
  }

  /** Flips a lever, or presses a button that is up and lets vanilla release it on time. */
  private boolean press(Block block) {
    var data = (Switch) block.getBlockData();
    if (block.getType() == Material.LEVER) {
      data.setPowered(!data.isPowered());
      block.setBlockData(data, true);
      return true;
    }
    if (data.isPowered()) {
      return false;
    }
    data.setPowered(true);
    block.setBlockData(data, true);
    var type = block.getType();
    var hold = Tag.WOODEN_BUTTONS.isTagged(type) ? WOODEN_PRESS : STONE_PRESS;
    kit.scheduler()
        .runOnMainThreadLater(
            hold,
            () -> {
              if (block.getType() == type) {
                block.tick();
              }
            });
    return true;
  }
}
