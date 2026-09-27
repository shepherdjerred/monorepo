package com.shepherdjerred.thestorm.qol.adapter.paper;

import static java.util.Objects.requireNonNull;
import static java.util.UUID.randomUUID;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.qol.app.QolStore;
import com.shepherdjerred.thestorm.qol.app.StoredGrave;
import com.shepherdjerred.thestorm.qol.domain.QolConfig;
import com.shepherdjerred.thestorm.qol.domain.grave.GraveAccess;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.bukkit.Material;
import org.bukkit.block.Block;
import org.bukkit.block.Chest;
import org.bukkit.block.DoubleChest;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockExplodeEvent;
import org.bukkit.event.block.BlockPistonExtendEvent;
import org.bukkit.event.entity.EntityExplodeEvent;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.inventory.InventoryMoveItemEvent;
import org.bukkit.event.inventory.InventoryOpenEvent;
import org.bukkit.inventory.InventoryHolder;
import org.bukkit.inventory.ItemStack;
import org.bukkit.plugin.Plugin;
import org.jspecify.annotations.Nullable;

/** A chest of drops. The owner opens it; after the lifetime it spills. */
final class GraveListener implements Listener {

  private final GraveMarks marks;
  private final QolStore store;
  private final QolConfig config;
  private final ModuleContext context;

  GraveListener(Plugin plugin, QolStore store, QolConfig config, ModuleContext context) {
    this.marks = new GraveMarks(plugin);
    this.store = store;
    this.config = config;
    this.context = context;
  }

  GraveMarks marks() {
    return marks;
  }

  @EventHandler
  public void onDeath(PlayerDeathEvent event) {
    var player = event.getEntity();
    var at = player.getLocation();
    if (at == null) {
      throw new IllegalStateException("player " + player.getName() + " has no location");
    }
    var world = player.getWorld();
    var feet = SafeColumn.below(world, at.getBlockX(), at.getBlockY(), at.getBlockZ());
    if (feet.isEmpty() || event.getDrops().isEmpty()) {
      return;
    }
    var drops = List.copyOf(event.getDrops());
    event.getDrops().clear();
    place(player, drops, world.getBlockAt(at.getBlockX(), feet.get(), at.getBlockZ()));
  }

  @EventHandler
  public void onOpen(InventoryOpenEvent event) {
    if (!(event.getPlayer() instanceof Player player)) {
      return;
    }
    if (denied(event.getInventory().getHolder(), player)) {
      event.setCancelled(true);
      player.sendMessage(Messages.error("That grave is not yours."));
    }
  }

  private boolean denied(@Nullable InventoryHolder holder, Player player) {
    if (holder instanceof DoubleChest combined) {
      return denied(combined.getLeftSide(), player) || denied(combined.getRightSide(), player);
    }
    if (!(holder instanceof Chest chest)) {
      return false;
    }
    return marks
        .read(chest)
        .map(
            grave ->
                GraveAccess.open(
                        player.getUniqueId(),
                        grave.owner(),
                        context.time().instant(),
                        grave.expires())
                    != GraveAccess.Open.OWNER)
        .orElse(false);
  }

  @EventHandler
  public void onBreak(BlockBreakEvent event) {
    if (marks.isGrave(event.getBlock())) {
      event.setCancelled(true);
    }
  }

  @EventHandler
  public void onExplode(EntityExplodeEvent event) {
    event.blockList().removeIf(marks::isGrave);
  }

  @EventHandler
  public void onBlockExplode(BlockExplodeEvent event) {
    event.blockList().removeIf(marks::isGrave);
  }

  @EventHandler
  public void onPiston(BlockPistonExtendEvent event) {
    if (event.getBlocks().stream().anyMatch(marks::isGrave)) {
      event.setCancelled(true);
    }
  }

  @EventHandler
  public void onHopper(InventoryMoveItemEvent event) {
    if (isGrave(event.getSource().getHolder())) {
      event.setCancelled(true);
    }
  }

  private boolean isGrave(@Nullable InventoryHolder holder) {
    if (holder instanceof DoubleChest combined) {
      return isGrave(combined.getLeftSide()) || isGrave(combined.getRightSide());
    }
    return holder instanceof Chest chest && marks.isGrave(chest.getBlock());
  }

  private void place(Player player, List<ItemStack> drops, Block block) {
    block.setType(Material.CHEST);
    if (!(block.getState() instanceof Chest chest)) {
      spill(block, drops);
      return;
    }
    var id = randomUUID();
    var expires = context.time().instant().plus(config.graveLifetimeDuration());
    marks.write(chest, player.getUniqueId(), expires);
    var leftover = chest.getBlockInventory().addItem(drops.toArray(ItemStack[]::new));
    spill(block, leftovers(leftover));
    var _ =
        store
            .insertGrave(
                new StoredGrave(
                    id,
                    player.getUniqueId(),
                    block.getWorld().getName(),
                    block.getX(),
                    block.getY(),
                    block.getZ(),
                    expires))
            .whenCompleteAsync(
                (ok, failure) -> {
                  if (failure != null) {
                    context.logger().error("Could not store grave {}", id, failure);
                    recover(block, player.getUniqueId(), expires);
                  }
                },
                context.scheduler().mainThread());
  }

  private void recover(Block block, java.util.UUID owner, java.time.Instant expires) {
    if (!(block.getState() instanceof Chest chest)
        || !marks
            .read(chest)
            .filter(mark -> mark.owner().equals(owner) && mark.expires().equals(expires))
            .isPresent()) {
      context.logger().error("Could not recover unpersisted grave at {}", block.getLocation());
      return;
    }
    var contents = requireNonNull(chest.getBlockInventory().getContents());
    chest.getBlockInventory().clear();
    block.setType(Material.AIR);
    for (var item : contents) {
      if (item != null && !item.isEmpty()) {
        spill(block, List.of(item));
      }
    }
  }

  private static List<ItemStack> leftovers(Map<Integer, ItemStack> leftover) {
    return new ArrayList<>(leftover.values());
  }

  private static void spill(Block block, List<ItemStack> items) {
    var at = block.getLocation();
    if (at == null) {
      throw new IllegalStateException("grave block has no location");
    }
    var world = block.getWorld();
    for (var item : items) {
      world.dropItemNaturally(at, item);
    }
  }
}
