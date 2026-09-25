package com.shepherdjerred.thestorm.tracks.app;

import org.bukkit.entity.Player;

/** A player's current track levels. Main thread; answers from memory for online players. */
public interface TrackLevels {

  /** The player's level in {@code track}: 0 if untrained, up to {@link Track#MAX_LEVEL}. */
  int level(Player player, Track track);
}
