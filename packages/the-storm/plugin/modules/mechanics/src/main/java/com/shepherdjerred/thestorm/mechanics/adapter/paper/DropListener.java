package com.shepherdjerred.thestorm.mechanics.adapter.paper;

import com.destroystokyo.paper.event.block.BlockDestroyEvent;
import com.shepherdjerred.thestorm.mechanics.app.Gatekeeper;
import com.shepherdjerred.thestorm.mechanics.domain.structure.Stock;
import java.util.List;
import org.bukkit.Material;
import org.bukkit.block.Block;
import org.bukkit.block.Sign;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockDropItemEvent;
import org.bukkit.event.block.BlockExplodeEvent;
import org.bukkit.event.entity.EntityExplodeEvent;
import org.bukkit.inventory.ItemStack;

/**
 * Drops from broken blocks: glass and bookshelves that drop themselves for Mechanics, and the
 * blocks a bridge, door or gate sign holds, which fall out when the sign is destroyed so no block
 * is lost with it.
 */
final class DropListener implements Listener {

  private final Kit kit;

  DropListener(Kit kit) {
    this.kit = kit;
  }

  /**
   * Replaces a broken glass block's or bookshelf's drops with the block itself, once the break has
   * happened and only when it would not already drop itself (silk touch).
   */
  @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
  void onDropItems(BlockDropItemEvent event) {
    var config = kit.config().blockDrops();
    var type = event.getBlockState().getType();
    var player = event.getPlayer();
    if (!config.unlock().enabled()
        || !config.allowed().contains(PaperGrid.key(type))
        || !Gatekeeper.hasLevel(player::hasPermission, config.unlock().level())
        || event.getItems().stream().anyMatch(item -> item.getItemStack().getType() == type)) {
      return;
    }
    event.getItems().clear();
    Items.drop(event.getBlock().getLocation().add(0.5, 0.5, 0.5), new ItemStack(type), 1);
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void onBreakForStock(BlockBreakEvent event) {
    releaseStock(event.getBlock());
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void onDestroy(BlockDestroyEvent event) {
    releaseStock(event.getBlock());
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void onEntityExplode(EntityExplodeEvent event) {
    releaseAll(event.blockList());
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void onBlockExplode(BlockExplodeEvent event) {
    releaseAll(event.blockList());
  }

  private void releaseAll(List<Block> blocks) {
    blocks.forEach(this::releaseStock);
  }

  /** Drops what a sign holds and empties it, so a second destroy event drops nothing more. */
  private void releaseStock(Block block) {
    if (!Signs.isSign(block.getType()) || !(block.getState() instanceof Sign sign)) {
      return;
    }
    var stock = kit.signs().stock(sign);
    if (stock.isEmpty()) {
      return;
    }
    var material = Material.matchMaterial(stock.material().orElseThrow());
    if (material == null) {
      throw new IllegalStateException("a sign holds an unknown block: " + stock);
    }
    kit.signs().setStock(sign, Stock.empty());
    sign.update();
    Items.drop(block.getLocation().add(0.5, 0.5, 0.5), new ItemStack(material), stock.count());
  }
}
