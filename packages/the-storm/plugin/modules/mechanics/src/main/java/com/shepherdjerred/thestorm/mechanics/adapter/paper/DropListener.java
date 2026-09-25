package com.shepherdjerred.thestorm.mechanics.adapter.paper;

import com.destroystokyo.paper.event.block.BlockDestroyEvent;
import com.shepherdjerred.thestorm.mechanics.app.Gatekeeper;
import com.shepherdjerred.thestorm.mechanics.domain.structure.Stock;
import java.util.List;
import org.bukkit.GameMode;
import org.bukkit.Material;
import org.bukkit.block.Block;
import org.bukkit.block.Sign;
import org.bukkit.enchantments.Enchantment;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockBreakEvent;
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

  @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
  void onBreakForDrops(BlockBreakEvent event) {
    var config = kit.config().blockDrops();
    var block = event.getBlock();
    var player = event.getPlayer();
    var tool = player.getInventory().getItemInMainHand();
    if (!config.unlock().enabled()
        || !event.isDropItems()
        || player.getGameMode() == GameMode.CREATIVE
        || !config.allowed().contains(PaperGrid.key(block.getType()))
        || tool.containsEnchantment(Enchantment.SILK_TOUCH)
        || !Gatekeeper.hasLevel(player::hasPermission, config.unlock().level())) {
      return;
    }
    event.setDropItems(false);
    Items.drop(block.getLocation().add(0.5, 0.5, 0.5), new ItemStack(block.getType()), 1);
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
