package com.shepherdjerred.thestorm.mechanics.adapter.paper;

import com.shepherdjerred.thestorm.core.protection.Decision;
import com.shepherdjerred.thestorm.core.protection.ProtectedAction;
import com.shepherdjerred.thestorm.mechanics.domain.grid.SignView;
import com.shepherdjerred.thestorm.mechanics.domain.sign.Mechanism;
import java.util.UUID;
import org.bukkit.block.Block;
import org.bukkit.block.Sign;
import org.bukkit.entity.Player;
import org.bukkit.event.Event;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.Action;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.inventory.EquipmentSlot;

/**
 * Clicks on signs: the sign copier tool first, then mechanism signs. A mechanism sign's use
 * replaces vanilla's (opening the editor); sneak-click to edit one instead.
 */
final class SignClickListener implements Listener {

  private final Kit kit;
  private final SignCopier copier;
  private final Handlers handlers;

  /** The per-mechanism handlers a click dispatches to. */
  record Handlers(
      Elevators elevators,
      Structures structures,
      CookingPots cookingPots,
      LightSwitches lightSwitches) {}

  SignClickListener(Kit kit, SignCopier copier, Handlers handlers) {
    this.kit = kit;
    this.copier = copier;
    this.handlers = handlers;
  }

  @EventHandler(priority = EventPriority.HIGH)
  void onInteract(PlayerInteractEvent event) {
    var block = event.getClickedBlock();
    if (event.getHand() != EquipmentSlot.HAND
        || block == null
        || event.useInteractedBlock() == Event.Result.DENY
        || !Signs.isSign(block.getType())
        || !(block.getState(false) instanceof Sign sign)) {
      return;
    }
    var player = event.getPlayer();
    if (copier.isTool(player.getInventory().getItemInMainHand())) {
      var handled =
          switch (event.getAction()) {
            case LEFT_CLICK_BLOCK -> copier.copy(player, sign);
            case RIGHT_CLICK_BLOCK -> copier.paste(player, block);
            case LEFT_CLICK_AIR, RIGHT_CLICK_AIR, PHYSICAL -> false;
          };
      if (handled) {
        event.setCancelled(true);
      }
      return;
    }
    if (event.getAction() != Action.RIGHT_CLICK_BLOCK || player.isSneaking()) {
      return;
    }
    var view = PaperGrid.view(block, PaperGrid.frontLines(sign));
    if (view.mechanism().isEmpty()) {
      return;
    }
    event.setUseInteractedBlock(Event.Result.DENY);
    event.setUseItemInHand(Event.Result.DENY);
    use(player, block, sign, view);
  }

  private void use(Player player, Block block, Sign sign, SignView view) {
    var mechanism = view.mechanism().orElseThrow();
    var feature = mechanism.feature();
    if (mechanism == Mechanism.HIDDEN_SWITCH || mechanism.isPiston()) {
      return;
    }
    var owner = kit.admit(player, feature, sign);
    if (owner.isEmpty()) {
      return;
    }
    var grid = new PaperGrid(block.getWorld());
    var pos = PaperGrid.pos(block);
    var entry = kit.guard().check(player.getUniqueId(), ProtectedAction.INTERACT, grid, pos);
    if (entry instanceof Decision.Denied(var reason)) {
      Replies.error(player, feature, reason);
      return;
    }
    dispatch(new Click(player, block, view, owner.orElseThrow()));
  }

  /** A permitted click on a mechanism sign. */
  private record Click(Player player, Block block, SignView view, UUID owner) {}

  private void dispatch(Click click) {
    var player = click.player();
    var block = click.block();
    var view = click.view();
    var mechanism = view.mechanism().orElseThrow();
    var grid = new PaperGrid(block.getWorld());
    var pos = PaperGrid.pos(block);
    switch (mechanism.feature()) {
      case ELEVATOR -> handlers.elevators().ride(player, grid, pos, mechanism);
      case BRIDGE, DOOR, GATE ->
          handlers.structures().click(player, new Structures.Use(grid, pos, view), click.owner());
      case COOKING_POT -> handlers.cookingPots().click(player, grid, pos, snapshot(block));
      case LIGHT_SWITCH -> handlers.lightSwitches().flip(player, grid, pos);
      case HIDDEN_SWITCH,
          BLOCK_DROPS,
          SIGN_COPIER,
          PAINTING_SWITCHER,
          CRUSH,
          BOUNCE,
          SUPER_STICKY,
          SUPER_PUSH -> {}
    }
  }

  private static Sign snapshot(Block block) {
    if (block.getState() instanceof Sign sign) {
      return sign;
    }
    throw new IllegalStateException("the clicked sign vanished at " + block);
  }
}
