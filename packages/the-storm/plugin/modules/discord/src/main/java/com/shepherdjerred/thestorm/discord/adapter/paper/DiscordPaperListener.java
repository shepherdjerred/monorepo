package com.shepherdjerred.thestorm.discord.adapter.paper;

import com.shepherdjerred.thestorm.discord.PlayerVisibility;
import com.shepherdjerred.thestorm.discord.adapter.discord.JdaGateway;
import com.shepherdjerred.thestorm.discord.domain.BridgeText;
import io.papermc.paper.event.player.AsyncChatEvent;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.player.PlayerAdvancementDoneEvent;
import org.bukkit.event.player.PlayerBedEnterEvent;
import org.bukkit.event.player.PlayerBedLeaveEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;

/** Paper event side of the bridge; every JDA send is queued asynchronously. */
public final class DiscordPaperListener implements Listener {

  private final JdaGateway gateway;

  public DiscordPaperListener(JdaGateway gateway) {
    this.gateway = gateway;
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  public void onChat(AsyncChatEvent event) {
    var content = PlainTextComponentSerializer.plainText().serialize(event.message());
    if (!BridgeText.clean(content).isEmpty()) {
      gateway.publishFromPlayer(
          event.getPlayer(), BridgeText.fromMinecraft(event.getPlayer().getName(), content));
    }
  }

  @EventHandler(priority = EventPriority.MONITOR)
  public void onJoin(PlayerJoinEvent event) {
    if (PlayerVisibility.isPublic(event.getPlayer())) {
      gateway.publish(BridgeText.clean(event.getPlayer().getName()) + " joined the server.");
    }
  }

  @EventHandler(priority = EventPriority.MONITOR)
  public void onQuit(PlayerQuitEvent event) {
    if (PlayerVisibility.isPublic(event.getPlayer())) {
      gateway.publish(BridgeText.clean(event.getPlayer().getName()) + " left the server.");
    }
  }

  @EventHandler(priority = EventPriority.MONITOR)
  public void onDeath(PlayerDeathEvent event) {
    var message = event.deathMessage();
    if (message != null && PlayerVisibility.isPublic(event.getPlayer())) {
      gateway.publish(PlainTextComponentSerializer.plainText().serialize(message));
    }
  }

  @EventHandler(priority = EventPriority.MONITOR)
  public void onAdvancement(PlayerAdvancementDoneEvent event) {
    var display = event.getAdvancement().getDisplay();
    if (display != null
        && display.doesAnnounceToChat()
        && PlayerVisibility.isPublic(event.getPlayer())) {
      var title = PlainTextComponentSerializer.plainText().serialize(display.title());
      gateway.publish(event.getPlayer().getName() + " earned advancement " + title + ".");
    }
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  public void onBedEnter(PlayerBedEnterEvent event) {
    if (event.enterAction().canSleep().success() && PlayerVisibility.isPublic(event.getPlayer())) {
      gateway.publish(event.getPlayer().getName() + " is sleeping.");
    }
  }

  @EventHandler(priority = EventPriority.MONITOR)
  public void onBedLeave(PlayerBedLeaveEvent event) {
    if (PlayerVisibility.isPublic(event.getPlayer())) {
      gateway.publish(event.getPlayer().getName() + " woke up.");
    }
  }
}
