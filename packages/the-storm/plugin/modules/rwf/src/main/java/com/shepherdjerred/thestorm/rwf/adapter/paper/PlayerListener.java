package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.rwf.domain.combat.AttackType;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchEvent;
import java.util.Optional;
import org.bukkit.Material;
import org.bukkit.entity.Player;
import org.bukkit.event.Event;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.Action;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.player.PlayerInteractEntityEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.event.player.PlayerRespawnEvent;
import org.bukkit.event.player.PlayerTeleportEvent;
import org.bukkit.inventory.ItemStack;

/**
 * Players and the match: restoring on join, leaving on quit (members and watchers), dying,
 * respawning as a spectator, teleport refusals, and the right-clicks that arm bombs, use the Time
 * Machine, open the kit menu and leave from the lobby.
 */
final class PlayerListener implements Listener {

  private final MatchRunner runner;
  private final Snapshots snapshots;
  private final ItemGuard items;
  private final PaperCombatantActions actions;
  private final CombatTracker tracker;
  private final PaperContext context;
  private final Keys keys;
  private final BombMarkers bombs;
  private final Watchers watchers;

  /**
   * What the listener needs.
   *
   * @param runner the match
   * @param snapshots human belongings
   * @param items the item guard, for sweeping
   * @param actions the shared bomb and Time Machine actions
   * @param tracker hit attribution
   * @param context the shared server services
   * @param keys item and entity tags
   * @param bombs bomb entities
   * @param watchers players watching the match
   */
  record Parts(
      MatchRunner runner,
      Snapshots snapshots,
      ItemGuard items,
      PaperCombatantActions actions,
      CombatTracker tracker,
      PaperContext context,
      Keys keys,
      BombMarkers bombs,
      Watchers watchers) {}

  PlayerListener(Parts parts) {
    this.runner = parts.runner();
    this.snapshots = parts.snapshots();
    this.items = parts.items();
    this.actions = parts.actions();
    this.tracker = parts.tracker();
    this.context = parts.context();
    this.keys = parts.keys();
    this.bombs = parts.bombs();
    this.watchers = parts.watchers();
  }

  private boolean inWorld(Player player) {
    return player.getWorld().equals(context.world());
  }

  /** On join: kit items never survive outside, and a crash's snapshot is restored. */
  @EventHandler(priority = EventPriority.MONITOR)
  void onJoin(PlayerJoinEvent event) {
    var player = event.getPlayer();
    items.sweep(player.getInventory());
    items.sweep(player.getEnderChest());
    if (runner.memberOf(player.getUniqueId()).isEmpty()) {
      snapshots.recover(player);
    }
  }

  @EventHandler(priority = EventPriority.MONITOR)
  void onQuit(PlayerQuitEvent event) {
    var id = event.getPlayer().getUniqueId();
    runner
        .memberOf(id)
        .ifPresent(member -> runner.handle(new MatchEvent.Disconnect(member.id(), runner.now())));
    watchers.quit(event.getPlayer());
  }

  /** Kits never drop, not even into another module's grave: drops and experience go first. */
  @EventHandler(priority = EventPriority.LOWEST)
  void clearDrops(PlayerDeathEvent event) {
    if (runner.memberOf(event.getPlayer().getUniqueId()).isPresent()) {
      event.getDrops().clear();
      event.setDroppedExp(0);
      event.setShouldDropExperience(false);
    }
  }

  @EventHandler(priority = EventPriority.HIGHEST)
  void onDeath(PlayerDeathEvent event) {
    var player = event.getPlayer();
    if (runner.memberOf(player.getUniqueId()).isEmpty()) {
      return;
    }
    event.getDrops().clear();
    event.setDroppedExp(0);
    event.setShouldDropExperience(false);
    event.setKeepInventory(false);
    event.deathMessage(null);
    var last = tracker.last(player.getUniqueId());
    var cause =
        runner.poisoned(player.getUniqueId())
            ? AttackType.END_OF_GAME
            : last.map(CombatTracker.Last::cause).orElse(AttackType.UNKNOWN);
    var killer =
        last.flatMap(CombatTracker.Last::attacker)
            .or(() -> Optional.ofNullable(player.getKiller()).map(Player::getUniqueId));
    runner.died(player, killer, cause);
  }

  @EventHandler(priority = EventPriority.HIGHEST)
  void onRespawn(PlayerRespawnEvent event) {
    var player = event.getPlayer();
    if (runner.awaitsSpectate(player.getUniqueId())) {
      event.setRespawnLocation(runner.spectatorPoint());
      context.scheduler().runOnMainThread(() -> runner.respawned(player));
      return;
    }
    if (runner.waiting(player.getUniqueId())) {
      // Nothing hurts in the lobby, but a /kill still lands: back to the lobby, ready again.
      event.setRespawnLocation(runner.lobby());
      context.scheduler().runOnMainThread(() -> runner.respawnedInLobby(player));
      return;
    }
    if (snapshots.waitsForRespawn(player.getUniqueId())) {
      event.setRespawnLocation(runner.lobby());
      context.scheduler().runOnMainThread(() -> snapshots.respawned(player));
    }
  }

  /**
   * Members and watchers cannot teleport out of the rwf world (pearls, homes, warps, /back, /tpa, a
   * spectator's jump to someone elsewhere) and nobody else may teleport into it while they are not
   * staff.
   */
  @EventHandler(ignoreCancelled = true, priority = EventPriority.HIGH)
  void onTeleport(PlayerTeleportEvent event) {
    var player = event.getPlayer();
    var id = player.getUniqueId();
    if (snapshots.restoring(id) || runner.isBot(id)) {
      // Being put back where they were, or a bot the roster is placing.
      return;
    }
    var toRwf = event.getTo().getWorld().equals(context.world());
    if (runner.memberOf(id).isPresent() || watchers.watching(id)) {
      if (!toRwf) {
        event.setCancelled(true);
        Texts.error(player, "You cannot leave the match that way. Use /rwf leave.");
      }
      return;
    }
    if (toRwf && !inWorld(player) && !Staff.exempt(player)) {
      event.setCancelled(true);
      Texts.error(player, "Join Search and Destroy with /rwf join.");
    }
  }

  /** Right-clicks inside the world: the fuse on a bomb block, the Time Machine, nothing else. */
  @EventHandler(priority = EventPriority.HIGH)
  void onInteract(PlayerInteractEvent event) {
    var player = event.getPlayer();
    if (!inWorld(player)) {
      return;
    }
    var member = runner.memberOf(player.getUniqueId());
    if (member.isEmpty()) {
      return;
    }
    var item = event.getItem();
    if (item != null && rightClick(event) && lobbyItem(event, player, item)) {
      return;
    }
    var block = event.getClickedBlock();
    if (event.getAction() == Action.RIGHT_CLICK_BLOCK && block != null && item != null) {
      var site = bombs.siteAt(Places.pos(block));
      if (site.isPresent() && keys.isFuse(item)) {
        event.setUseInteractedBlock(Event.Result.DENY);
        event.setUseItemInHand(Event.Result.DENY);
        actions
            .clickBomb(member.orElseThrow().id(), site.orElseThrow().id())
            .ifPresent(refusal -> Texts.error(player, refusal));
        return;
      }
    }
    if (item != null
        && item.getType() == Material.CLOCK
        && keys.isKitItem(item)
        && rightClick(event)) {
      event.setUseItemInHand(Event.Result.DENY);
      actions
          .useRewind(member.orElseThrow().id())
          .ifPresent(refusal -> Texts.error(player, refusal));
    }
  }

  /**
   * The lobby's selector opens the kit menu and its leave item leaves, as {@code /rwf leave} does.
   * Returns whether {@code item} was one of them.
   */
  private boolean lobbyItem(PlayerInteractEvent event, Player player, ItemStack item) {
    if (keys.isSelector(item)) {
      event.setUseItemInHand(Event.Result.DENY);
      event.setUseInteractedBlock(Event.Result.DENY);
      runner.openKitMenu(player).ifPresent(refusal -> Texts.error(player, refusal));
      return true;
    }
    if (keys.isLeave(item)) {
      event.setUseItemInHand(Event.Result.DENY);
      event.setUseInteractedBlock(Event.Result.DENY);
      runner.leave(player).ifPresent(refusal -> Texts.error(player, refusal));
      return true;
    }
    return false;
  }

  private static boolean rightClick(PlayerInteractEvent event) {
    return event.getAction() == Action.RIGHT_CLICK_AIR
        || event.getAction() == Action.RIGHT_CLICK_BLOCK;
  }

  /** Members touch no entity but an armed bomb, with the fuse. */
  @EventHandler(ignoreCancelled = true, priority = EventPriority.HIGH)
  void onInteractEntity(PlayerInteractEntityEvent event) {
    var player = event.getPlayer();
    var member = runner.memberOf(player.getUniqueId());
    if (member.isEmpty()) {
      return;
    }
    event.setCancelled(true);
    var bomb = bombs.bombOf(event.getRightClicked());
    if (bomb.isPresent() && keys.isFuse(player.getInventory().getItemInMainHand())) {
      actions
          .clickBomb(member.orElseThrow().id(), bomb.orElseThrow())
          .ifPresent(refusal -> Texts.error(player, refusal));
    }
  }

  /** The combatant id of {@code player}, for commands. */
  static CombatantId human(Player player) {
    return new CombatantId.Human(player.getUniqueId());
  }
}
