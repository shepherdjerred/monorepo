package com.shepherdjerred.thestorm.shops.adapter.paper;

import com.shepherdjerred.thestorm.shops.app.ChestShops;
import com.shepherdjerred.thestorm.shops.app.ShopLocks;
import com.shepherdjerred.thestorm.shops.app.ShopRegistry;
import com.shepherdjerred.thestorm.shops.domain.shop.ShopOwner;
import com.shepherdjerred.thestorm.shops.domain.shop.SignShop;
import io.papermc.paper.event.entity.ItemTransportingEntityValidateTargetEvent;
import io.papermc.paper.event.player.PlayerOpenSignEvent;
import java.util.List;
import java.util.Optional;
import java.util.stream.Stream;
import org.bukkit.block.Block;
import org.bukkit.block.data.type.Chest;
import org.bukkit.entity.Player;
import org.bukkit.event.Event;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.Action;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockBurnEvent;
import org.bukkit.event.block.BlockExplodeEvent;
import org.bukkit.event.block.BlockPistonExtendEvent;
import org.bukkit.event.block.BlockPistonRetractEvent;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.entity.EntityChangeBlockEvent;
import org.bukkit.event.entity.EntityExplodeEvent;
import org.bukkit.event.inventory.InventoryMoveItemEvent;
import org.bukkit.event.inventory.InventoryOpenEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.inventory.EquipmentSlot;

/**
 * Keeps shop stock where it belongs. A shop's container opens only for its owner (and admins),
 * whatever the land's container flags say; the sign and container break only for them; no machine
 * or mob (hopper, hopper minecart, dropper, crafter, copper golem) ever moves items into or out of
 * it, even on the owner's own land; nothing opens while a trade is settling; and explosions,
 * pistons, fire and mobs leave shops alone.
 */
final class ShopGuardListener implements Listener {

  private final ShopRegistry registry;
  private final ShopLocks locks;
  private final ShopBlocks blocks;
  private final ChestShops shops;

  ShopGuardListener(ShopLocks locks, ShopBlocks blocks, ChestShops shops) {
    this.registry = blocks.registry();
    this.locks = locks;
    this.blocks = blocks;
    this.shops = shops;
  }

  /**
   * Right-clicking a shop container: the usual way to open it. Blocks may still be placed against
   * it; only opening is refused.
   */
  @EventHandler(priority = EventPriority.HIGH)
  public void onContainerClick(PlayerInteractEvent event) {
    var block = event.getClickedBlock();
    if (event.getAction() != Action.RIGHT_CLICK_BLOCK
        || block == null
        || event.useInteractedBlock() == Event.Result.DENY) {
      return;
    }
    var shopsHere = blocks.shopsOnContainer(block);
    if (shopsHere.isEmpty()) {
      return;
    }
    refusal(event.getPlayer(), shopsHere, "container")
        .ifPresent(
            reason -> {
              event.setUseInteractedBlock(Event.Result.DENY);
              if (event.getHand() == EquipmentSlot.HAND) {
                event.getPlayer().sendMessage(Replies.error(reason));
              }
            });
  }

  /** Any other way a shop container's inventory opens. */
  @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
  public void onOpen(InventoryOpenEvent event) {
    var shopsHere = blocks.shopsOwning(event.getInventory());
    if (shopsHere.isEmpty() || !(event.getPlayer() instanceof Player player)) {
      return;
    }
    refusal(player, shopsHere, "container")
        .ifPresent(
            reason -> {
              event.setCancelled(true);
              player.sendMessage(Replies.error(reason));
            });
  }

  @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
  public void onBreak(BlockBreakEvent event) {
    var block = event.getBlock();
    var shopsHere = blocks.shopsAt(block);
    if (shopsHere.isEmpty()) {
      return;
    }
    var player = event.getPlayer();
    var refusal = refusal(player, shopsHere, "shop");
    if (refusal.isPresent()) {
      event.setCancelled(true);
      player.sendMessage(Replies.error(refusal.orElseThrow()));
      return;
    }
    var pos = ShopBlocks.pos(block);
    var removed =
        Stream.concat(registry.atSign(pos).stream(), registry.tradingFrom(pos).stream())
            .distinct()
            .toList();
    removed.forEach(shops::remove);
    if (!removed.isEmpty()) {
      player.sendMessage(Replies.info(removed.size() == 1 ? "Shop removed." : "Shops removed."));
    }
  }

  /** No one else may join a chest onto a shop chest: the double chest would open for them. */
  @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
  public void onPlace(BlockPlaceEvent event) {
    var placed = event.getBlockPlaced();
    if (!(placed.getBlockData() instanceof Chest)) {
      return;
    }
    var player = event.getPlayer();
    var neighbors = blocks.shopsOnContainer(placed);
    if (!neighbors.isEmpty() && !mayManage(player, neighbors)) {
      event.setCancelled(true);
      player.sendMessage(Replies.error("That would reach into " + owners(neighbors) + "."));
    }
  }

  /**
   * Hoppers, hopper minecarts, droppers and crafters never move items into or out of a shop
   * container, whoever owns the land or the machine: shop stock moves only through trades and its
   * owner's hands.
   */
  @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
  public void onMachineMove(InventoryMoveItemEvent event) {
    if (!blocks.shopsOwning(event.getSource()).isEmpty()
        || !blocks.shopsOwning(event.getDestination()).isEmpty()) {
      event.setCancelled(true);
    }
  }

  /** Copper golems never take items from, or bring items to, a shop container. */
  @EventHandler(priority = EventPriority.HIGH)
  public void onGolemTarget(ItemTransportingEntityValidateTargetEvent event) {
    if (!blocks.shopsOnContainer(event.getBlock()).isEmpty()) {
      event.setAllowed(false);
    }
  }

  @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
  public void onEntityExplode(EntityExplodeEvent event) {
    event.blockList().removeIf(this::isShopBlock);
  }

  @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
  public void onBlockExplode(BlockExplodeEvent event) {
    event.blockList().removeIf(this::isShopBlock);
  }

  @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
  public void onPistonExtend(BlockPistonExtendEvent event) {
    if (event.getBlocks().stream().anyMatch(this::isShopBlock)) {
      event.setCancelled(true);
    }
  }

  @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
  public void onPistonRetract(BlockPistonRetractEvent event) {
    if (event.getBlocks().stream().anyMatch(this::isShopBlock)) {
      event.setCancelled(true);
    }
  }

  @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
  public void onEntityChangeBlock(EntityChangeBlockEvent event) {
    if (isShopBlock(event.getBlock())) {
      event.setCancelled(true);
    }
  }

  @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
  public void onBurn(BlockBurnEvent event) {
    if (isShopBlock(event.getBlock())) {
      event.setCancelled(true);
    }
  }

  /** Shop signs are rewritten only by the plugin, never in the sign editor. */
  @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
  public void onOpenSign(PlayerOpenSignEvent event) {
    if (registry.atSign(ShopBlocks.pos(event.getSign().getBlock())).isPresent()) {
      event.setCancelled(true);
    }
  }

  private boolean isShopBlock(Block block) {
    return !blocks.shopsAt(block).isEmpty();
  }

  private boolean isBusy(List<SignShop> shopsHere) {
    return shopsHere.stream().anyMatch(shop -> locks.isBusy(shop.id()));
  }

  /** Why {@code player} may not open or break these shops right now, if they may not. */
  private Optional<String> refusal(Player player, List<SignShop> shopsHere, String what) {
    if (isBusy(shopsHere)) {
      return Optional.of("A trade with this shop is going through; try again.");
    }
    return mayManage(player, shopsHere)
        ? Optional.empty()
        : Optional.of("This " + what + " belongs to " + owners(shopsHere) + ".");
  }

  /** Admins, or the player who owns every one of these shops. */
  private static boolean mayManage(Player player, List<SignShop> shopsHere) {
    return player.hasPermission(ShopsPaper.ADMIN_PERMISSION)
        || shopsHere.stream().allMatch(shop -> shop.owner().isOwnedBy(player.getUniqueId()));
  }

  private static String owners(List<SignShop> shopsHere) {
    return shopsHere.stream()
        .map(
            shop ->
                switch (shop.owner()) {
                  case ShopOwner.Player(_, var name) -> name;
                  case ShopOwner.Admin() -> "the server";
                })
        .distinct()
        .reduce((a, b) -> a + " and " + b)
        .orElseThrow();
  }
}
