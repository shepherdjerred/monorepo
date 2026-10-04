package com.shepherdjerred.thestorm.discord.adapter.paper;

import com.shepherdjerred.thestorm.chat.app.ChatAuthor;
import com.shepherdjerred.thestorm.chat.app.ChatLine;
import com.shepherdjerred.thestorm.core.world.SealedWorlds;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Consumer;
import org.bukkit.Server;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerChangedWorldEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;

/**
 * Which world each online player stands in, kept on the main thread so the chat relay can ask from
 * Paper's async chat thread without touching the Bukkit API. A Global line written by a player in a
 * sealed world (a match, its bots included) never reaches Discord. Sealing is checked per line, so
 * a world sealed while players already stand in it takes effect at once.
 */
public final class SealedPlayers implements Listener {

  private final SealedWorlds sealed;
  private final Map<UUID, String> worlds = new ConcurrentHashMap<>();

  private SealedPlayers(SealedWorlds sealed) {
    this.sealed = sealed;
  }

  /** Starts tracking from the players already online; register the result as a listener. */
  public static SealedPlayers track(Server server, SealedWorlds sealed) {
    var players = new SealedPlayers(sealed);
    for (var player : server.getOnlinePlayers()) {
      players.worlds.put(player.getUniqueId(), player.getWorld().getName());
    }
    return players;
  }

  @EventHandler(priority = EventPriority.MONITOR)
  public void onJoin(PlayerJoinEvent event) {
    worlds.put(event.getPlayer().getUniqueId(), event.getPlayer().getWorld().getName());
  }

  @EventHandler(priority = EventPriority.MONITOR)
  public void onWorldChange(PlayerChangedWorldEvent event) {
    worlds.put(event.getPlayer().getUniqueId(), event.getPlayer().getWorld().getName());
  }

  @EventHandler(priority = EventPriority.MONITOR)
  public void onQuit(PlayerQuitEvent event) {
    worlds.remove(event.getPlayer().getUniqueId());
  }

  /** Whether {@code line} came from a player standing in a sealed world. Safe on any thread. */
  public boolean inSealedWorld(ChatLine line) {
    return line.author() instanceof ChatAuthor.InGame(var id, var _) && inSealedWorld(id);
  }

  /** Whether the online player {@code id} stands in a sealed world. Safe on any thread. */
  public boolean inSealedWorld(UUID id) {
    var world = worlds.get(id);
    return world != null && sealed.isSealed(world);
  }

  /** {@code relay}, skipping lines from players in sealed worlds. */
  public Consumer<ChatLine> guarding(Consumer<ChatLine> relay) {
    return line -> {
      if (!inSealedWorld(line)) {
        relay.accept(line);
      }
    };
  }
}
