package com.shepherdjerred.mcbridge.adapter.paper;

import com.shepherdjerred.mcbridge.domain.EventRing;
import com.shepherdjerred.mcbridge.domain.EventType;
import com.shepherdjerred.mcbridge.domain.PlainText;
import io.papermc.paper.event.player.AsyncChatEvent;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.block.Block;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;
import org.bukkit.event.Event;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.Action;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.player.PlayerCommandPreprocessEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.event.server.ServerCommandEvent;
import org.jspecify.annotations.Nullable;

/**
 * Feeds chat, commands, joins, quits, deaths, block breaks and placements, block interactions and
 * player melee damage into the event ring. Players and harness actors are recorded alike.
 */
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

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  public void onBreak(BlockBreakEvent event) {
    ring.add(EventType.BLOCK_BREAK, event.getPlayer().getName(), describe(event.getBlock()));
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  public void onPlace(BlockPlaceEvent event) {
    ring.add(EventType.BLOCK_PLACE, event.getPlayer().getName(), describe(event.getBlockPlaced()));
  }

  /** Right- and left-clicks on blocks; {@code denied} marks a listener blocking the use. */
  @EventHandler(priority = EventPriority.MONITOR)
  public void onInteract(PlayerInteractEvent event) {
    Block block = event.getClickedBlock();
    Action action = event.getAction();
    if (block == null
        || (action != Action.RIGHT_CLICK_BLOCK && action != Action.LEFT_CLICK_BLOCK)) {
      return;
    }
    String denied = event.useInteractedBlock() == Event.Result.DENY ? " (denied)" : "";
    ring.add(
        EventType.INTERACT,
        event.getPlayer().getName(),
        action.name() + " " + describe(block) + denied);
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  public void onDamage(EntityDamageByEntityEvent event) {
    if (event.getDamager() instanceof Player attacker) {
      Entity victim = event.getEntity();
      ring.add(
          EventType.DAMAGE,
          attacker.getName(),
          "hit "
              + victim.getType().getKey().asString()
              + " "
              + victim.getUniqueId()
              + " for "
              + event.getFinalDamage());
    }
  }

  private static String describe(Block block) {
    return block.getBlockData().getAsString()
        + " at "
        + block.getX()
        + ","
        + block.getY()
        + ","
        + block.getZ();
  }

  private static String plain(@Nullable Component component) {
    if (component == null) {
      return "";
    }
    return PlainText.strip(PlainTextComponentSerializer.plainText().serialize(component));
  }
}
