package com.shepherdjerred.thestorm.essentials.adapter.paper;

import com.shepherdjerred.thestorm.essentials.app.AfkTracker;
import com.shepherdjerred.thestorm.essentials.app.PlayerDirectory;
import com.shepherdjerred.thestorm.essentials.app.TpaDesk;
import com.shepherdjerred.thestorm.essentials.app.store.PlayerStore.KnownPlayer;
import java.util.Optional;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;

/**
 * Joins and quits: remembers names, welcomes new players (spawn and the starter kit), and clears a
 * leaving player's AFK state, requests and pending teleport.
 *
 * <p>A player is new only if essentials has never seen them <em>and</em> the server has no record
 * of them, so players from the world as it was before essentials are not sent to spawn.
 */
final class SessionListener implements Listener {

  private final PaperRuntime runtime;
  private final PlayerDirectory players;
  private final Presence presence;
  private final Arrival arrival;

  /**
   * Per-player state to clear when a player leaves.
   *
   * @param afk away status
   * @param tpa teleport requests
   * @param flow pending teleports
   * @param safe last safe spots
   */
  record Presence(AfkTracker afk, TpaDesk tpa, TeleportFlow flow, SafeTracker safe) {}

  /**
   * How new players are welcomed.
   *
   * @param spawn where they arrive
   * @param kits the kits, including the starter kit
   */
  record Arrival(
      com.shepherdjerred.thestorm.essentials.app.RuntimeDestinations spawn,
      PlayerCommands.Kits kits) {}

  SessionListener(
      PaperRuntime runtime, PlayerDirectory players, Presence presence, Arrival arrival) {
    this.runtime = runtime;
    this.players = players;
    this.presence = presence;
    this.arrival = arrival;
  }

  @EventHandler(priority = EventPriority.MONITOR)
  void onJoin(PlayerJoinEvent event) {
    if (!com.shepherdjerred.thestorm.core.players.Humans.isHuman(event.getPlayer())) return;
    var player = event.getPlayer();
    presence.afk().joined(player.getUniqueId());
    arrival.kits().deliveries().deliver(player.getUniqueId());
    var playedBefore = player.hasPlayedBefore();
    var known = new KnownPlayer(player.getUniqueId(), player.getName(), runtime.time().instant());
    runtime.onMain(
        players.joined(
            known,
            playedBefore ? Optional.empty() : Optional.of(arrival.kits().settings().starter())),
        "recording a join",
        first -> {
          if (first && !playedBefore && player.isOnline()) {
            welcome(player);
          }
        });
  }

  @EventHandler(priority = EventPriority.MONITOR)
  void onQuit(PlayerQuitEvent event) {
    if (!com.shepherdjerred.thestorm.core.players.Humans.isHuman(event.getPlayer())) return;
    var id = event.getPlayer().getUniqueId();
    presence.afk().left(id);
    presence.tpa().forget(id);
    presence.flow().left(id);
    presence.safe().forget(id);
    arrival.kits().deliveries().quit(id);
  }

  private void welcome(Player player) {
    Positions.toLocation(runtime.server(), arrival.spawn().spawn())
        .ifPresent(
            spawn ->
                runtime.logFailure(player.teleportAsync(spawn), "sending a new player to spawn"));
    arrival.kits().deliveries().deliver(player.getUniqueId());
    Say.success(player, Say.STORM, "Welcome to The Storm, " + player.getName() + "! Read /rules.");
  }
}
