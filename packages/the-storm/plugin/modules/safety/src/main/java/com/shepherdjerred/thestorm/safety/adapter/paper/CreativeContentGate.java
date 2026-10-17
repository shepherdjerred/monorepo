package com.shepherdjerred.thestorm.safety.adapter.paper;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.safety.ContentSafety;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import net.kyori.adventure.text.Component;
import org.bukkit.GameMode;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.inventory.InventoryCreativeEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.inventory.ItemStack;

/**
 * Client-authored creative metadata is held; a one-use approval preserves native inventory rules.
 */
public final class CreativeContentGate implements Listener {
  private record Grant(ItemStack item, int slot, Instant expires, UUID submission) {}

  private final ModuleContext context;
  private final ContentAdmission admission;
  private final Map<UUID, Grant> grants = new HashMap<>();
  private final java.util.IdentityHashMap<InventoryCreativeEvent, UUID> receipts =
      new java.util.IdentityHashMap<>();

  public CreativeContentGate(ModuleContext context, ContentSafety safety) {
    this.context = context;
    admission = new ContentAdmission(context, safety);
  }

  @EventHandler(priority = EventPriority.LOWEST, ignoreCancelled = true)
  public void creative(InventoryCreativeEvent event) {
    if (!(event.getWhoClicked() instanceof Player player)) return;
    var item = event.getCursor().clone();
    if (!item.hasItemMeta()) return;
    var grant = grants.remove(player.getUniqueId());
    if (grant != null
        && grant.item().equals(item)
        && grant.slot() == event.getRawSlot()
        && context.time().instant().isBefore(grant.expires())) {
      receipts.put(event, grant.submission());
      return;
    }
    event.setCancelled(true);
    var meta = item.getItemMeta().getAsString();
    var submission =
        admission.submission(
            player,
            new ContentAdmission.Draft(
                "creative-item", "item-viewers", meta, "", "slot:" + event.getRawSlot()));
    admission.publish(
        player,
        submission,
        () -> {
          if (player.getGameMode() != GameMode.CREATIVE) return "creative-stale";
          grants.put(
              player.getUniqueId(),
              new Grant(
                  item,
                  event.getRawSlot(),
                  context.time().instant().plusSeconds(10),
                  submission.id()));
          player.sendMessage(
              Component.text("Item content approved; select it again within 10 seconds."));
          return "creative-approved-retry";
        });
  }

  @EventHandler(priority = EventPriority.MONITOR)
  public void receipt(InventoryCreativeEvent event) {
    var id = receipts.remove(event);
    if (id != null)
      admission.record(
          id,
          event.isCancelled() ? "creative-denied-by-protection" : "creative-native-event-accepted");
  }

  @EventHandler(priority = EventPriority.MONITOR)
  public void quit(PlayerQuitEvent event) {
    grants.remove(event.getPlayer().getUniqueId());
  }
}
