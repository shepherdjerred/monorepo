package com.shepherdjerred.thestorm.arena.adapter.paper;

import com.shepherdjerred.thestorm.arena.domain.game.GameEvent;
import com.shepherdjerred.thestorm.arena.domain.game.Member;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.bukkit.block.Block;
import org.bukkit.block.Container;
import org.bukkit.event.Event;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.Action;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.inventory.InventoryOpenEvent;
import org.bukkit.event.inventory.InventoryType;
import org.bukkit.event.player.PlayerDropItemEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.event.player.PlayerRespawnEvent;
import org.bukkit.event.player.PlayerTeleportEvent;
import org.bukkit.inventory.Inventory;

/**
 * Players and the arena: restoring on join, leaving on quit and death, keeping items and players
 * inside, and the class signs, ready block and join signs.
 */
final class PlayerListener implements Listener {

  private final PaperContext context;
  private final Arenas arenas;
  private final Snapshots snapshots;
  private final ArenaCommands commands;
  private final Keys keys;

  PlayerListener(PaperContext context, Arenas arenas, ArenaCommands commands, Keys keys) {
    this.context = context;
    this.arenas = arenas;
    this.snapshots = arenas.snapshots();
    this.commands = commands;
    this.keys = keys;
  }

  /** On join: arena items never survive outside, and a crash's snapshot is restored. */
  @EventHandler(priority = EventPriority.MONITOR)
  void onJoin(PlayerJoinEvent event) {
    var player = event.getPlayer();
    sweep(player.getInventory());
    sweep(player.getEnderChest());
    if (arenas.arenaOf(player.getUniqueId()).isEmpty()) {
      snapshots.recover(player);
    }
  }

  private void sweep(Inventory inventory) {
    for (var slot = 0; slot < inventory.getSize(); slot++) {
      var item = inventory.getItem(slot);
      if (item != null && keys.isArenaItem(item)) {
        inventory.setItem(slot, null);
      }
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
    if (runner.isEmpty() || isPending(runner.orElseThrow(), id)) {
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
      }
    }
  }

  @EventHandler(ignoreCancelled = true)
  void onDrop(PlayerDropItemEvent event) {
    if (arrived(event.getPlayer().getUniqueId()).isPresent()) {
      event.setCancelled(true);
    }
  }

  /** Pearls, chorus fruit, homes and warps cannot take a player out of their arena. */
  @EventHandler(ignoreCancelled = true, priority = EventPriority.HIGH)
  void onTeleport(PlayerTeleportEvent event) {
    var runner = arrived(event.getPlayer().getUniqueId());
    if (runner.isPresent() && !runner.orElseThrow().world().contains(event.getTo())) {
      event.setCancelled(true);
      Texts.error(event.getPlayer(), "You cannot leave the arena that way. Use /arena leave.");
    }
  }

  @EventHandler(ignoreCancelled = true)
  void onOpen(InventoryOpenEvent event) {
    if (event.getInventory().getType() == InventoryType.ENDER_CHEST
        && arrived(event.getPlayer().getUniqueId()).isPresent()) {
      event.setCancelled(true);
    }
  }

  @EventHandler(priority = EventPriority.HIGH)
  void onInteract(PlayerInteractEvent event) {
    var block = event.getClickedBlock();
    if (block == null || event.getAction() != Action.RIGHT_CLICK_BLOCK) {
      return;
    }
    if (joinSign(event, block)) {
      return;
    }
    var runner = arrived(event.getPlayer().getUniqueId());
    if (runner.isPresent() && runner.orElseThrow().world().contains(block.getLocation())) {
      insideArena(event, block, runner.orElseThrow());
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

  /** Class signs and the ready block work; only fighters open loot chests; no other container. */
  private void insideArena(PlayerInteractEvent event, Block block, GameRunner runner) {
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

  /** The arena {@code player} is in, once their snapshot is stored (not while still joining). */
  private Optional<GameRunner> arrived(UUID player) {
    return arenas.of(player).filter(runner -> !isPending(runner, player));
  }

  private static boolean isPending(GameRunner runner, UUID player) {
    return runner.member(player).filter(Member.Pending.class::isInstance).isPresent();
  }
}
