package com.shepherdjerred.thestorm.mechanics.app;

import com.shepherdjerred.thestorm.mechanics.domain.stargate.NetworkAccess;
import com.shepherdjerred.thestorm.towns.app.TownMembership;
import com.shepherdjerred.thestorm.tracks.app.Track;
import com.shepherdjerred.thestorm.tracks.app.TrackLevels;
import org.bukkit.entity.Player;

/** The live track and town checks shared by Stargate creation and travel. Main thread only. */
public record StargateAccess(TrackLevels tracks, TownMembership towns) {

  /** A player may use the network only while its current access rules permit them. */
  public boolean mayUse(Player player, NetworkAccess network) {
    var playerId = player.getUniqueId();
    return network.permits(playerId, townId -> towns.isMember(playerId, townId));
  }

  /** Track data must have loaded and Mechanic III must be held when a gate is created. */
  public boolean mayCreate(Player player, NetworkAccess network) {
    return tracks.isLoaded(player.getUniqueId())
        && tracks.level(player, Track.MECHANIC) >= 3
        && mayUse(player, network);
  }
}
