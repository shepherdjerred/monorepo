package com.shepherdjerred.thestorm.arena.adapter.paper;

import com.shepherdjerred.thestorm.arena.domain.game.GameEvent;
import java.util.Map;
import org.bukkit.block.Block;
import org.bukkit.block.Container;
import org.bukkit.event.Event;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.Action;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.event.player.PlayerRespawnEvent;
import org.bukkit.event.player.PlayerTeleportEvent;

/**
 * Players and the arena: restoring on join, leaving on quit and death, keeping members in and
 * outsiders out, and the class signs, ready block and join signs.
 */
final class PlayerListener implements Listener {

  private final PaperContext context;
  private final Arenas arenas;
  private final Snapshots snapshots;
  private final ArenaCommands commands;
  private final ItemGuard items;

  PlayerListener(PaperContext context, Arenas arenas, ArenaCommands commands, ItemGuard items) {
    this.context = context;
    this.arenas = arenas;
    this.snapshots = arenas.snapshots();
    this.commands = commands;
    this.items = items;
  }

  /**
   * On join: arena items never survive outside, and a crash's snapshot is restored (once they
   * respawn, if they left while dead).
   */
  @EventHandler(priority = EventPriority.MONITOR)
  void onJoin(PlayerJoinEvent event) {
    var player = event.getPlayer();
    items.sweep(player.getInventory());
    items.sweep(player.getEnderChest());
    if (arenas.arenaOf(player.getUniqueId()).isEmpty()) {
      snapshots.recover(player);
    }
  }

  @EventHandler(priority = EventPriority.MONITOR)
  void onQuit(PlayerQuitEvent event) {
    var id = event.getPlayer().getUniqueId();
    arenas.all().stream()
        .filter(runner -> runner.awaitsRespawn(id))
        .forEach(runner -> runner.quitWhileDead(id));
    arenas.of(id).ifPresent(runner -> runner.handle(new GameEvent.Disconnect(id)));
  }

  /** Nothing drops in an arena; the player's belongings come back from their snapshot. */
  @EventHandler(priority = EventPriority.HIGHEST)
  void onDeath(PlayerDeathEvent event) {
    var id = event.getPlayer().getUniqueId();
    var runner = arenas.of(id);
    if (runner.isEmpty()) {
      return;
    }
    event.getDrops().clear();
    event.setDroppedExp(0);
    event.setShouldDropExperience(false);
    event.setKeepInventory(false);
    runner.orElseThrow().handle(new GameEvent.Died(id));
  }

  @EventHandler(priority = EventPriority.HIGHEST)
  void onRespawn(PlayerRespawnEvent event) {
    var player = event.getPlayer();
    for (var runner : arenas.all()) {
      if (runner.awaitsRespawn(player.getUniqueId())) {
        event.setRespawnLocation(runner.exit());
        context.scheduler().runOnMainThread(() -> runner.respawned(player));
        return;
      }
    }
    if (snapshots.waitsForRespawn(player.getUniqueId())) {
      context.scheduler().runOnMainThread(() -> snapshots.respawned(player));
    }
  }

  /**
   * Members cannot teleport out of their arena (pearls, chorus fruit, homes, warps, /back, /tpa)
   * and players still joining cannot teleport at all. Nobody else may teleport into an arena while
   * a game runs there.
   */
  @EventHandler(ignoreCancelled = true, priority = EventPriority.HIGH)
  void onTeleport(PlayerTeleportEvent event) {
    var player = event.getPlayer();
    var id = player.getUniqueId();
    if (arenas.joining(id)) {
      event.setCancelled(true);
      return;
    }
    var home = arenas.arrived(id);
    if (home.isPresent()) {
      if (!home.orElseThrow().world().contains(event.getTo())) {
        event.setCancelled(true);
        Texts.error(player, "You cannot leave the arena that way. Use /arena leave.");
      }
      return;
    }
    var target = arenas.runningAt(event.getTo());
    if (target.isPresent() && !target.orElseThrow().world().contains(event.getFrom())) {
      event.setCancelled(true);
      Texts.error(player, "A game is under way in that arena. Use /arena spec to watch.");
    }
  }

  @EventHandler(priority = EventPriority.HIGH)
  void onInteract(PlayerInteractEvent event) {
    var id = event.getPlayer().getUniqueId();
    if (arenas.joining(id)) {
      event.setCancelled(true);
      return;
    }
    var block = event.getClickedBlock();
    if (block == null) {
      return;
    }
    var home = arenas.arrived(id);
    if (home.isPresent()) {
      member(event, block, home.orElseThrow());
      return;
    }
    if (event.getAction() == Action.RIGHT_CLICK_BLOCK && !joinSign(event, block)) {
      outsider(event, block);
    }
  }

  /** A member reaches only blocks in their arena: its signs, ready block and loot chests. */
  private void member(PlayerInteractEvent event, Block block, GameRunner runner) {
    if (!runner.world().contains(block.getLocation())) {
      event.setCancelled(true);
      return;
    }
    if (event.getAction() != Action.RIGHT_CLICK_BLOCK) {
      return;
    }
    var player = event.getPlayer();
    var pos = Places.pos(block);
    var definition = runner.world().definition();
    var kit =
        definition.classSigns().entrySet().stream()
            .filter(sign -> sign.getValue().equals(pos))
            .map(Map.Entry::getKey)
            .findFirst();
    if (kit.isPresent()) {
      event.setUseInteractedBlock(Event.Result.DENY);
      commands.pickClass(player, kit.orElseThrow());
    } else if (definition.readyBlock().equals(pos)) {
      event.setUseInteractedBlock(Event.Result.DENY);
      commands.ready(player);
    } else if (block.getState() instanceof Container
        && !(definition.lootChests().contains(pos) && runner.isFighter(player.getUniqueId()))) {
      event.setUseInteractedBlock(Event.Result.DENY);
    }
  }

  /** Nobody outside a running game opens a container in its arena. */
  private void outsider(PlayerInteractEvent event, Block block) {
    if (block.getState() instanceof Container
        && arenas.runningAt(block.getLocation()).isPresent()) {
      event.setUseInteractedBlock(Event.Result.DENY);
    }
  }

  private boolean joinSign(PlayerInteractEvent event, Block block) {
    var pos = Places.pos(block);
    for (var runner : arenas.all()) {
      if (block.getWorld().equals(runner.world().world())
          && runner.world().definition().joinSigns().contains(pos)) {
        event.setUseInteractedBlock(Event.Result.DENY);
        arenas.join(event.getPlayer(), runner);
        return true;
      }
    }
    return false;
  }
}
