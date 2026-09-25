package com.shepherdjerred.thestorm.tracks.app;

/**
 * The price of one track level for one player, as offered before they confirm.
 *
 * @param track the track
 * @param level the level being bought, one above the player's current level
 * @param cost the price in whole crystals
 */
public record Quote(Track track, int level, long cost) {

  public Quote {
    if (level < 1 || level > Track.MAX_LEVEL) {
      throw new IllegalArgumentException(
          "quote level must be 1.." + Track.MAX_LEVEL + ": " + level);
    }
    if (cost < 1) {
      throw new IllegalArgumentException("a track level costs at least one crystal: " + cost);
    }
  }
}
