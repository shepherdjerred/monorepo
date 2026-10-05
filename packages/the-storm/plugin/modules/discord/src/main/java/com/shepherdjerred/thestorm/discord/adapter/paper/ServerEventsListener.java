package com.shepherdjerred.thestorm.discord.adapter.paper;

import com.shepherdjerred.thestorm.core.world.SealedWorlds;
import com.shepherdjerred.thestorm.discord.app.DiscordRelay;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.player.PlayerAdvancementDoneEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;

/**
 * Feeds joins, leaves, deaths and advancements to the relay. Runs at MONITOR so it sees the final
 * death and advancement messages other modules settled on. Players in a sealed world (a minigame
 * arena, its bots included) are not relayed.
 */
public final class ServerEventsListener implements Listener {

  private final DiscordRelay relay;
  private final VanillaPlainText text;
  private final SealedWorlds sealed;

  public ServerEventsListener(DiscordRelay relay, VanillaPlainText text, SealedWorlds sealed) {
    this.relay = relay;
    this.text = text;
    this.sealed = sealed;
  }

  @EventHandler(priority = EventPriority.MONITOR)
  public void onJoin(PlayerJoinEvent event) {
    if (!com.shepherdjerred.thestorm.core.players.Humans.isHuman(event.getPlayer())) return;
    if (sealed.isSealed(event.getPlayer().getWorld())
        || com.shepherdjerred.thestorm.core.players.PlayerVisibility.hidden(event.getPlayer())) {
      return;
    }
    relay.onJoin(event.getPlayer().getName());
  }

  @EventHandler(priority = EventPriority.MONITOR)
  public void onQuit(PlayerQuitEvent event) {
    if (!com.shepherdjerred.thestorm.core.players.Humans.isHuman(event.getPlayer())) return;
    if (sealed.isSealed(event.getPlayer().getWorld())
        || com.shepherdjerred.thestorm.core.players.PlayerVisibility.hidden(event.getPlayer())) {
      return;
    }
    relay.onLeave(event.getPlayer().getName());
  }

  /** Posts the final death message; nothing when it was hidden or removed. */
  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  public void onDeath(PlayerDeathEvent event) {
    if (!com.shepherdjerred.thestorm.core.players.Humans.isHuman(event.getEntity())) return;
    var message = event.deathMessage();
    if (sealed.isSealed(event.getPlayer().getWorld())
        || com.shepherdjerred.thestorm.core.players.PlayerVisibility.hidden(event.getPlayer())) {
      return;
    }
    if (message != null && event.getShowDeathMessages()) {
      relay.onDeath(text.plain(message));
    }
  }

  @EventHandler(priority = EventPriority.MONITOR)
  public void onAdvancement(PlayerAdvancementDoneEvent event) {
    if (sealed.isSealed(event.getPlayer().getWorld())
        || com.shepherdjerred.thestorm.core.players.PlayerVisibility.hidden(event.getPlayer())) {
      return;
    }
    var advancement = event.getAdvancement();
    var display = advancement.getDisplay();
    var title = display == null ? "" : text.plain(display.title());
    var announced = display != null && display.doesAnnounceToChat() && event.message() != null;
    relay.onAdvancement(
        event.getPlayer().getName(), advancement.getKey().getKey(), title, announced);
  }
}
