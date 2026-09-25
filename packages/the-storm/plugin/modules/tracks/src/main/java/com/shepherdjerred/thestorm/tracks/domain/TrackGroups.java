package com.shepherdjerred.thestorm.tracks.domain;

import com.shepherdjerred.thestorm.tracks.app.Track;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * The permission groups that grant track levels: {@code storm-<track>-<level>} grants {@link
 * Track#permission(int)} for that level and inherits the level below, so a player belongs to one
 * group per track, the one for their level.
 */
public final class TrackGroups {

  /** Every group this module owns starts with this. */
  public static final String PREFIX = "storm-";

  private static final Pattern NAME = Pattern.compile("storm-([a-z]+)-([1-9])");

  private TrackGroups() {}

  /**
   * One group to declare.
   *
   * @param name the group name
   * @param permission the permission it grants
   * @param parent the group it inherits, empty for level I
   */
  public record Definition(String name, String permission, Optional<String> parent) {}

  /** The group for {@code level} of {@code track}. */
  public static String name(Track track, int level) {
    if (level < 1 || level > Track.MAX_LEVEL) {
      throw new IllegalArgumentException("level must be 1.." + Track.MAX_LEVEL + ": " + level);
    }
    return PREFIX + track.id() + "-" + level;
  }

  /** Every group, level I before level II within each track, so parents come first. */
  public static List<Definition> definitions() {
    var definitions = new ArrayList<Definition>();
    for (var track : Track.values()) {
      for (var level = 1; level <= Track.MAX_LEVEL; level++) {
        var parent = level == 1 ? Optional.<String>empty() : Optional.of(name(track, level - 1));
        definitions.add(new Definition(name(track, level), track.permission(level), parent));
      }
    }
    return List.copyOf(definitions);
  }

  /** The groups a player with {@code progress} belongs to: one per owned track. */
  public static Set<String> memberships(TrackProgress progress) {
    return progress.owned().stream()
        .map(owned -> name(owned.track(), owned.level()))
        .collect(Collectors.toUnmodifiableSet());
  }

  /** Whether {@code group} is one of this module's track groups. */
  public static boolean isTrackGroup(String group) {
    var matcher = NAME.matcher(group);
    if (!matcher.matches()) {
      return false;
    }
    var level = Integer.parseInt(matcher.group(2));
    return level <= Track.MAX_LEVEL && TrackIds.parse(matcher.group(1)).isPresent();
  }
}
