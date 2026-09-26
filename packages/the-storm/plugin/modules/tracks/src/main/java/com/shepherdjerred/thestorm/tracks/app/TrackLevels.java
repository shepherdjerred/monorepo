package com.shepherdjerred.thestorm.tracks.app;

import java.util.UUID;
import org.bukkit.entity.Player;

/** A player's current track levels. Main thread; answers from memory for online players. */
public interface TrackLevels {

  /**
   * The player's level in {@code track}: 0 if untrained, up to {@link Track#MAX_LEVEL}. Also 0
   * while their levels are still loading after they join; see {@link #isLoaded}.
   */
  int level(Player player, Track track);

  /**
   * Whether {@code player} is online and their levels have loaded, so {@link #level} is their real
   * level rather than 0 for "not known yet". A caller that must not treat a loading player as
   * untrained (for example, refusing an action they may be entitled to) asks them to wait instead.
   */
  boolean isLoaded(UUID player);
}
