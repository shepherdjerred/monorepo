package com.shepherdjerred.thestorm.discord.adapter.paper;

import com.shepherdjerred.thestorm.discord.app.DiscordRelay;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.player.PlayerAdvancementDoneEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;

/**
 * Feeds joins, leaves, deaths and advancements to the relay. Runs at MONITOR so it sees the final
 * death and advancement messages other modules settled on.
 */
public final class ServerEventsListener implements Listener {

  private final DiscordRelay relay;

  public ServerEventsListener(DiscordRelay relay) {
    this.relay = relay;
  }

  @EventHandler(priority = EventPriority.MONITOR)
  public void onJoin(PlayerJoinEvent event) {
    relay.onJoin(event.getPlayer().getName());
  }

  @EventHandler(priority = EventPriority.MONITOR)
  public void onQuit(PlayerQuitEvent event) {
    relay.onLeave(event.getPlayer().getName());
  }

  /** Posts the final death message; nothing when it was hidden or removed. */
  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  public void onDeath(PlayerDeathEvent event) {
    var message = event.deathMessage();
    if (message != null && event.getShowDeathMessages()) {
      relay.onDeath(plain(message));
    }
  }

  @EventHandler(priority = EventPriority.MONITOR)
  public void onAdvancement(PlayerAdvancementDoneEvent event) {
    var advancement = event.getAdvancement();
    var display = advancement.getDisplay();
    var title = display == null ? "" : plain(display.title());
    var announced = display != null && display.doesAnnounceToChat() && event.message() != null;
    relay.onAdvancement(
        event.getPlayer().getName(), advancement.getKey().getKey(), title, announced);
  }

  /** Plain text; on Paper, vanilla translation keys are rendered in English. */
  private static String plain(Component component) {
    return PlainTextComponentSerializer.plainText().serialize(component);
  }
}
