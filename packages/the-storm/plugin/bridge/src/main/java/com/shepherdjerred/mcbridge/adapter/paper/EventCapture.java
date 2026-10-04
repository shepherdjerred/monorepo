package com.shepherdjerred.mcbridge.adapter.paper;

import com.shepherdjerred.mcbridge.domain.EventRing;
import com.shepherdjerred.mcbridge.domain.EventType;
import com.shepherdjerred.mcbridge.domain.PlainText;
import io.papermc.paper.event.player.AsyncChatEvent;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.player.PlayerCommandPreprocessEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.event.server.ServerCommandEvent;
import org.jspecify.annotations.Nullable;

/** Feeds chat, commands, joins, quits and deaths into the event ring. */
public final class EventCapture implements Listener {
  private final EventRing ring;

  public EventCapture(EventRing ring) {
    this.ring = ring;
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  public void onChat(AsyncChatEvent event) {
    ring.add(EventType.CHAT, event.getPlayer().getName(), plain(event.message()));
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  public void onPlayerCommand(PlayerCommandPreprocessEvent event) {
    ring.add(EventType.COMMAND, event.getPlayer().getName(), event.getMessage());
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  public void onServerCommand(ServerCommandEvent event) {
    String sender = event.getSender() instanceof Player player ? player.getName() : null;
    ring.add(EventType.COMMAND, sender, "/" + event.getCommand());
  }

  @EventHandler(priority = EventPriority.MONITOR)
  public void onJoin(PlayerJoinEvent event) {
    ring.add(EventType.JOIN, event.getPlayer().getName(), event.getPlayer().getName() + " joined");
  }

  @EventHandler(priority = EventPriority.MONITOR)
  public void onQuit(PlayerQuitEvent event) {
    ring.add(EventType.QUIT, event.getPlayer().getName(), event.getPlayer().getName() + " left");
  }

  @EventHandler(priority = EventPriority.MONITOR)
  public void onDeath(PlayerDeathEvent event) {
    Component message = event.deathMessage();
    String text = message == null ? event.getPlayer().getName() + " died" : plain(message);
    ring.add(EventType.DEATH, event.getPlayer().getName(), text);
  }

  private static String plain(@Nullable Component component) {
    if (component == null) {
      return "";
    }
    return PlainText.strip(PlainTextComponentSerializer.plainText().serialize(component));
  }
}
