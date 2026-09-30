package com.shepherdjerred.thestorm.towns.adapter.paper;

import com.shepherdjerred.thestorm.towns.app.OwnerLevels;
import com.shepherdjerred.thestorm.tracks.app.Track;
import com.shepherdjerred.thestorm.tracks.app.TrackLevels;
import java.util.OptionalInt;
import java.util.UUID;
import org.bukkit.Server;
import org.bukkit.entity.Player;

/**
 * Online players' Governor levels. The tracks port answers 0 until a player's progress has loaded,
 * a moment after they join, and their track permissions (one per level reached, granted through
 * LuckPerms) are there from the start; the higher of the two is their level, so a town's stored
 * limit never drops because its owner was read too early.
 */
final class GovernorLevels implements OwnerLevels {

  private final Server server;
  private final TrackLevels levels;

  GovernorLevels(Server server, TrackLevels levels) {
    this.server = server;
    this.levels = levels;
  }

  @Override
  public OptionalInt liveLevel(UUID player) {
    var online = server.getPlayer(player);
    return online == null ? OptionalInt.empty() : OptionalInt.of(of(online));
  }

  int of(Player player) {
    var granted = 0;
    for (var level = Track.MAX_LEVEL; level >= 1; level--) {
      if (player.hasPermission(Track.GOVERNOR.permission(level))) {
        granted = level;
        break;
      }
    }
    return Math.max(granted, levels.level(player, Track.GOVERNOR));
  }
}
