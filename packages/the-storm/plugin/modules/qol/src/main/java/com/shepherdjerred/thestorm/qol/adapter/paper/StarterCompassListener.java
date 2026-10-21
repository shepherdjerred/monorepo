package com.shepherdjerred.thestorm.qol.adapter.paper;

import com.shepherdjerred.thestorm.npcs.app.NpcInteractEvent;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryCloseEvent;
import org.bukkit.event.inventory.InventoryDragEvent;
import org.bukkit.event.player.PlayerChangedWorldEvent;
import org.bukkit.event.player.PlayerDropItemEvent;
import org.bukkit.event.player.PlayerInteractEntityEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.event.player.PlayerRespawnEvent;
import org.bukkit.event.player.PlayerSwapHandItemsEvent;
import org.bukkit.inventory.EquipmentSlot;

/** Compass use never punches an NPC, opens a container, or leaves an item in a grave. */
final class StarterCompassListener implements Listener {
  private final StarterCompass compass;
  private final ArrivalDialog dialog;

  StarterCompassListener(StarterCompass compass, ArrivalDialog dialog) {
    this.compass = compass;
    this.dialog = dialog;
  }

  private void open(Player player) {
    if (compass.pending(player)) dialog.show(player);
    else compass.reconcile(player);
  }

  @EventHandler(priority = EventPriority.LOWEST)
  void use(PlayerInteractEvent event) {
    if (event.getHand() != EquipmentSlot.HAND
        || !compass.manages(event.getPlayer())
        || !StarterCompass.marked(event.getItem())
        || (!event.getAction().isLeftClick() && !event.getAction().isRightClick())) return;
    event.setCancelled(true);
    open(event.getPlayer());
  }

  @EventHandler(priority = EventPriority.LOWEST)
  void entity(PlayerInteractEntityEvent event) {
    if (event.getHand() != EquipmentSlot.HAND
        || !compass.manages(event.getPlayer())
        || !StarterCompass.marked(event.getPlayer().getInventory().getItemInMainHand())) return;
    event.setCancelled(true);
    open(event.getPlayer());
  }

  @EventHandler(priority = EventPriority.LOWEST)
  void npc(NpcInteractEvent event) {
    if (!compass.manages(event.player())) return;
    if (!StarterCompass.marked(event.player().getInventory().getItemInMainHand())) return;
    event.setCancelled(true);
    open(event.player());
  }

  @EventHandler(priority = EventPriority.LOWEST)
  void punch(EntityDamageByEntityEvent event) {
    if (!(event.getDamager() instanceof Player player)
        || !compass.manages(player)
        || !StarterCompass.marked(player.getInventory().getItemInMainHand())) return;
    event.setCancelled(true);
    open(player);
  }

  @EventHandler
  void drop(PlayerDropItemEvent event) {
    if (!compass.manages(event.getPlayer())) return;
    if (StarterCompass.marked(event.getItemDrop().getItemStack())) event.setCancelled(true);
  }

  @EventHandler
  void swap(PlayerSwapHandItemsEvent event) {
    if (!compass.manages(event.getPlayer())) return;
    if (StarterCompass.marked(event.getMainHandItem())
        || StarterCompass.marked(event.getOffHandItem())) event.setCancelled(true);
  }

  @EventHandler
  void click(InventoryClickEvent event) {
    if (!(event.getWhoClicked() instanceof Player player)) return;
    if (!compass.manages(player)) return;
    if (StarterCompass.marked(event.getCurrentItem())
        || StarterCompass.marked(event.getCursor())
        || (compass.pending(player)
            && (event.getHotbarButton() == StarterCompass.SLOT
                || (player.getInventory().equals(event.getClickedInventory())
                    && event.getSlot() == StarterCompass.SLOT)))) event.setCancelled(true);
  }

  @EventHandler
  void drag(InventoryDragEvent event) {
    if (!(event.getWhoClicked() instanceof Player player)) return;
    if (!compass.manages(player)) return;
    if (StarterCompass.marked(event.getOldCursor())
        || (compass.pending(player)
            && event.getRawSlots().stream()
                .anyMatch(
                    slot ->
                        player.getInventory().equals(event.getView().getInventory(slot))
                            && event.getView().convertSlot(slot) == StarterCompass.SLOT)))
      event.setCancelled(true);
  }

  @EventHandler(priority = EventPriority.LOWEST)
  void death(PlayerDeathEvent event) {
    if (!compass.manages(event.getEntity())) return;
    event.getDrops().removeIf(StarterCompass::marked);
    if (!event.getKeepInventory() && compass.pending(event.getEntity()))
      event.getItemsToKeep().add(StarterCompass.item(event.getEntity()));
  }

  @EventHandler
  void respawn(PlayerRespawnEvent event) {
    compass.afterRespawn(event.getPlayer());
  }

  @EventHandler(priority = EventPriority.MONITOR)
  void world(PlayerChangedWorldEvent event) {
    compass.afterRespawn(event.getPlayer());
  }

  @EventHandler
  void close(InventoryCloseEvent event) {
    if (event.getPlayer() instanceof Player player && compass.pending(player))
      compass.afterRespawn(player);
  }

  @EventHandler
  void quit(PlayerQuitEvent event) {
    compass.left(event.getPlayer());
  }
}
