package com.shepherdjerred.thestorm.towns.adapter.paper;

import com.shepherdjerred.thestorm.towns.app.TownService;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;

/**
 * Keeps each town's stored Governor level current: an owner's level is recorded when they join and
 * when they leave, so their town's claim limit holds while they are away. Joining players also hear
 * about open invitations.
 */
final class JoinListener implements Listener {

  private final TownService towns;
  private final GovernorLevels levels;
  private final MemberCommands members;

  JoinListener(TownService towns, GovernorLevels levels, MemberCommands members) {
    this.towns = towns;
    this.levels = levels;
    this.members = members;
  }

  @EventHandler(priority = EventPriority.MONITOR)
  void onJoin(PlayerJoinEvent event) {
    if (!com.shepherdjerred.thestorm.core.players.Humans.isHuman(event.getPlayer())) return;
    record(event.getPlayer());
    members.tellInvitations(event.getPlayer());
  }

  @EventHandler(priority = EventPriority.MONITOR)
  void onQuit(PlayerQuitEvent event) {
    if (!com.shepherdjerred.thestorm.core.players.Humans.isHuman(event.getPlayer())) return;
    record(event.getPlayer());
  }

  private void record(Player player) {
    towns.recordGovernorLevel(player.getUniqueId(), levels.of(player));
  }
}
