package com.shepherdjerred.thestorm.shops.adapter.paper;

import com.shepherdjerred.thestorm.core.protection.Protection;
import com.shepherdjerred.thestorm.shops.app.ChestShops;
import com.shepherdjerred.thestorm.shops.app.ShopLocks;
import com.shepherdjerred.thestorm.shops.app.ShopRegistry;
import com.shepherdjerred.thestorm.shops.domain.shop.ShopOwner;
import com.shepherdjerred.thestorm.shops.domain.shop.SignShop;
import io.papermc.paper.event.player.PlayerOpenSignEvent;
import java.util.List;
import java.util.Optional;
import java.util.stream.Stream;
import org.bukkit.Material;
import org.bukkit.block.Block;
import org.bukkit.block.BlockFace;
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
import org.bukkit.inventory.Inventory;

/**
 * Keeps shop stock where it belongs. A shop's container opens only for its owner (and admins),
 * whatever the land's container flags say; the sign and container break only for them; hoppers may
 * pull stock out only on the owner's own land; nothing moves while a trade is settling; and
 * explosions, pistons, fire and mobs leave shops alone.
 */
final class ShopGuardListener implements Listener {

  private final ShopRegistry registry;
  private final ShopLocks locks;
  private final ShopBlocks blocks;
  private final ChestShops shops;
  private final Protection protection;

  ShopGuardListener(ShopLocks locks, ShopBlocks blocks, ChestShops shops, Protection protection) {
    this.registry = blocks.registry();
    this.locks = locks;
    this.blocks = blocks;
    this.shops = shops;
    this.protection = protection;
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

  /**
   * No one else may join a chest onto a shop chest (the double chest would open for them) or hang a
   * hopper under a shop container.
   */
  @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
  public void onPlace(BlockPlaceEvent event) {
    var placed = event.getBlockPlaced();
    var player = event.getPlayer();
    List<SignShop> neighbors;
    if (placed.getBlockData() instanceof Chest) {
      neighbors = blocks.shopsOnContainer(placed);
    } else if (placed.getType() == Material.HOPPER) {
      neighbors = blocks.shopsAt(placed.getRelative(BlockFace.UP));
    } else {
      return;
    }
    if (!neighbors.isEmpty() && !mayManage(player, neighbors)) {
      event.setCancelled(true);
      player.sendMessage(Replies.error("That would reach into " + owners(neighbors) + "."));
    }
  }

  @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
  public void onHopper(InventoryMoveItemEvent event) {
    var from = blocks.shopsOwning(event.getSource());
    if (!from.isEmpty() && (isBusy(from) || !pullsOnOwnersLand(event.getDestination(), from))) {
      event.setCancelled(true);
      return;
    }
    var into = blocks.shopsOwning(event.getDestination());
    if (!into.isEmpty() && isBusy(into)) {
      event.setCancelled(true);
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

  /**
   * A hopper block may pull a shop's stock only when it sits on the same owner's land as the
   * container; hopper minecarts and anything else never may. Placing a hopper under a shop is
   * already refused to everyone but the owner.
   */
  private boolean pullsOnOwnersLand(Inventory destination, List<SignShop> from) {
    var hopper = ShopBlocks.hopperBlock(destination);
    if (hopper.isEmpty()) {
      return false;
    }
    var at = hopper.orElseThrow();
    return from.stream()
        .allMatch(
            shop ->
                shop.container()
                    .flatMap(blocks::center)
                    .map(container -> protection.sameLand(at, container))
                    .orElse(false));
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
