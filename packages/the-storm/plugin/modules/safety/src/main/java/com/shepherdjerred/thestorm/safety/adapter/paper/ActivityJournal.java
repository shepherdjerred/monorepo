package com.shepherdjerred.thestorm.safety.adapter.paper;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.safety.app.ActivityWrites;
import com.shepherdjerred.thestorm.safety.app.EvidenceStore;
import com.shepherdjerred.thestorm.safety.app.SafetyService;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.EntityPickupItemEvent;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryCloseEvent;
import org.bukkit.event.inventory.InventoryDragEvent;
import org.bukkit.event.inventory.InventoryOpenEvent;
import org.bukkit.event.player.PlayerDropItemEvent;
import org.bukkit.event.player.PlayerGameModeChangeEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.event.player.PlayerTeleportEvent;
import org.bukkit.inventory.ItemStack;

/** Complements CoreProtect with attempted/denied interactions and full item text snapshots. */
public final class ActivityJournal implements Listener {
  private final ModuleContext context;
  private final ActivityWrites writes;
  private final ContentAdmission admission;

  public ActivityJournal(ModuleContext context, SafetyService safety, ActivityWrites writes) {
    this.context = context;
    this.writes = writes;
    admission = new ContentAdmission(context, safety);
  }

  private void record(Player player, String details, String object, boolean denied) {
    var submission =
        admission.submission(
            player, new ContentAdmission.Draft("activity", "staff", details, "", object));
    writes.record(
        new EvidenceStore.Observation(
            submission, denied ? "denied" : "observed", context.time().instant()));
  }

  private static String item(ItemStack item) {
    return item.getType()
        + " x"
        + item.getAmount()
        + " "
        + (item.hasItemMeta() ? item.getItemMeta().getAsString() : "{}");
  }

  @EventHandler(priority = EventPriority.MONITOR)
  public void join(PlayerJoinEvent event) {
    var player = event.getPlayer();
    record(
        player,
        "join client=" + player.getClientBrandName(),
        player.getLocation()
            + " inventory="
            + java.util.Arrays.stream(player.getInventory().getContents())
                .filter(java.util.Objects::nonNull)
                .map(ActivityJournal::item)
                .toList(),
        false);
  }

  @EventHandler(priority = EventPriority.MONITOR)
  public void open(InventoryOpenEvent event) {
    if (event.getPlayer() instanceof Player player)
      record(
          player,
          "inventory-open "
              + java.util.Arrays.stream(event.getInventory().getContents())
                  .filter(java.util.Objects::nonNull)
                  .map(ActivityJournal::item)
                  .toList(),
          event.getInventory().getType() + ":" + event.getInventory().getLocation(),
          event.isCancelled());
  }

  @EventHandler(priority = EventPriority.MONITOR)
  public void close(InventoryCloseEvent event) {
    if (event.getPlayer() instanceof Player player)
      record(
          player,
          "inventory-close "
              + java.util.Arrays.stream(event.getInventory().getContents())
                  .filter(java.util.Objects::nonNull)
                  .map(ActivityJournal::item)
                  .toList(),
          event.getInventory().getType() + ":" + event.getInventory().getLocation(),
          false);
  }

  @EventHandler(priority = EventPriority.MONITOR)
  public void pickup(EntityPickupItemEvent event) {
    if (event.getEntity() instanceof Player player)
      record(
          player,
          "item-pickup " + item(event.getItem().getItemStack()),
          event.getItem().getUniqueId().toString(),
          event.isCancelled());
  }

  @EventHandler(priority = EventPriority.MONITOR)
  public void quit(PlayerQuitEvent event) {
    record(
        event.getPlayer(),
        "quit " + event.getReason().name(),
        event.getPlayer().getLocation().toString(),
        false);
  }

  @EventHandler(priority = EventPriority.MONITOR)
  public void teleport(PlayerTeleportEvent event) {
    record(
        event.getPlayer(),
        "teleport " + event.getCause() + " " + event.getFrom() + " -> " + event.getTo(),
        "",
        event.isCancelled());
  }

  @EventHandler(priority = EventPriority.MONITOR)
  public void mode(PlayerGameModeChangeEvent event) {
    record(
        event.getPlayer(), "game-mode " + event.getNewGameMode().name(), "", event.isCancelled());
  }

  @EventHandler(priority = EventPriority.MONITOR)
  public void breakBlock(BlockBreakEvent event) {
    record(
        event.getPlayer(),
        "block-break " + event.getBlock().getType().name(),
        event.getBlock().getLocation().toString(),
        event.isCancelled());
  }

  @EventHandler(priority = EventPriority.MONITOR)
  public void place(BlockPlaceEvent event) {
    record(
        event.getPlayer(),
        "block-place " + item(event.getItemInHand()),
        event.getBlock().getLocation().toString(),
        event.isCancelled());
  }

  @EventHandler(priority = EventPriority.MONITOR)
  public void drop(PlayerDropItemEvent event) {
    record(
        event.getPlayer(),
        "item-drop " + item(event.getItemDrop().getItemStack()),
        event.getItemDrop().getUniqueId().toString(),
        event.isCancelled());
  }

  @EventHandler(priority = EventPriority.MONITOR)
  public void click(InventoryClickEvent event) {
    if (!(event.getWhoClicked() instanceof Player player)) return;
    var current = event.getCurrentItem();
    var cursor = event.getCursor();
    record(
        player,
        "inventory-click "
            + event.getAction()
            + " slot="
            + event.getRawSlot()
            + " current="
            + (current == null ? "empty" : item(current))
            + " cursor="
            + item(cursor),
        event.getView().getTopInventory().getType()
            + ":"
            + event.getView().getTopInventory().getLocation(),
        event.isCancelled());
  }

  @EventHandler(priority = EventPriority.MONITOR)
  public void drag(InventoryDragEvent event) {
    if (event.getWhoClicked() instanceof Player player)
      record(
          player,
          "inventory-drag "
              + event.getNewItems().entrySet().stream()
                  .map(entry -> entry.getKey() + ":" + item(entry.getValue()))
                  .reduce("", (all, next) -> all + "\n" + next),
          event.getInventory().getType().name(),
          event.isCancelled());
  }

  @EventHandler(priority = EventPriority.MONITOR)
  public void damage(EntityDamageByEntityEvent event) {
    var attacker =
        event.getDamager() instanceof org.bukkit.entity.Projectile projectile
            ? projectile.getShooter()
            : event.getDamager();
    if (attacker instanceof Player player)
      record(
          player,
          "attack "
              + event.getEntity().getUniqueId()
              + " type="
              + event.getEntityType()
              + " damage="
              + event.getFinalDamage(),
          event.getEntity().getLocation().toString(),
          event.isCancelled());
    if (event.getEntity() instanceof Player player)
      record(
          player,
          "damage "
              + event.getDamager().getUniqueId()
              + " cause="
              + event.getCause()
              + " damage="
              + event.getFinalDamage(),
          player.getLocation().toString(),
          event.isCancelled());
  }

  @EventHandler(priority = EventPriority.MONITOR)
  public void death(PlayerDeathEvent event) {
    record(
        event.getPlayer(),
        "death drops=" + event.getDrops().stream().map(ActivityJournal::item).toList(),
        event.getPlayer().getLocation().toString(),
        false);
  }
}
