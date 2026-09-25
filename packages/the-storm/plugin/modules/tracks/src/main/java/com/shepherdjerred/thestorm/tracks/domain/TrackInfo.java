package com.shepherdjerred.thestorm.tracks.domain;

import com.shepherdjerred.thestorm.tracks.app.Track;
import java.util.HexFormat;
import java.util.List;
import java.util.regex.Pattern;

/**
 * How a track is presented to players.
 *
 * @param displayName the track's name in messages
 * @param color the track's color as {@code #RRGGBB}
 * @param summary one sentence on what the track is for
 * @param levels levels I to V in order
 */
public record TrackInfo(String displayName, String color, String summary, List<LevelInfo> levels) {

  private static final Pattern HEX_COLOR = Pattern.compile("#[0-9A-Fa-f]{6}");

  public TrackInfo {
    levels = List.copyOf(levels);
    if (displayName.isBlank() || summary.isBlank()) {
      throw new IllegalArgumentException("a track needs a displayName and a summary");
    }
    if (!HEX_COLOR.matcher(color).matches()) {
      throw new IllegalArgumentException("color must be #RRGGBB: " + color);
    }
    if (levels.size() != Track.MAX_LEVEL) {
      throw new IllegalArgumentException(
          displayName + " needs exactly " + Track.MAX_LEVEL + " levels, has " + levels.size());
    }
  }

  /** {@link #color} as a 24-bit RGB value. */
  public int rgb() {
    return HexFormat.fromHexDigits(color, 1, color.length());
  }

  /** Level {@code level} (1 to {@link Track#MAX_LEVEL}). */
  public LevelInfo level(int level) {
    if (level < 1 || level > Track.MAX_LEVEL) {
      throw new IllegalArgumentException("level must be 1.." + Track.MAX_LEVEL + ": " + level);
    }
    return levels.get(level - 1);
  }
}
