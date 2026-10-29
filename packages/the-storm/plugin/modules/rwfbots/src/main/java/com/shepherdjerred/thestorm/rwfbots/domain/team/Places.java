package com.shepherdjerred.thestorm.rwfbots.domain.team;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavSites;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TreeMap;

/**
 * Names a point the way a player would call it in team chat. The maps name no regions, so a place
 * is named after what stands there: {@code red bomb}, {@code the nuke} or {@code blue base} near a
 * bomb or a spawn, else the side of the map it lies on ({@code red side} or {@code mid}) with a
 * compass word across the field when it is off the middle line ({@code west mid}). Minecraft's
 * compass: north is -z, east is +x. Pure.
 */
public final class Places {

  /** A point this close to a bomb is named after it. */
  static final double AT_BOMB = 10;

  /** A point this close to a team's spawn is named after its base. */
  static final double AT_BASE = 14;

  /** A point this far off the line between the bases gets a compass word. */
  static final double OFF_LINE = 10;

  /** A point closer to one base than this share of the distance to the next is on its side. */
  static final double SIDE_SHARE = 0.7;

  private final List<Mark> bombs;
  private final Map<String, Vec3> bases;
  private final Vec3 middle;
  private final Vec3 across;

  private record Mark(String name, Vec3 pos) {}

  /** The places of a map with {@code sites}; {@code fallbackMiddle} when it has no spawns. */
  public Places(NavSites sites, Vec3 fallbackMiddle) {
    var marks = new ArrayList<Mark>();
    for (var site : sites.bombs()) {
      var name = site.team().map(team -> color(team) + " bomb").orElse("the nuke");
      marks.add(new Mark(name, site.cell().center()));
    }
    bombs = List.copyOf(marks);
    var grouped = new TreeMap<String, List<Vec3>>();
    for (var site : sites.spawns()) {
      site.team()
          .ifPresent(
              team ->
                  grouped
                      .computeIfAbsent(color(team), ignored -> new ArrayList<>())
                      .add(site.cell().feet()));
    }
    var homes = new TreeMap<String, Vec3>();
    grouped.forEach((team, points) -> homes.put(team, centroid(points)));
    bases = Map.copyOf(homes);
    middle = homes.isEmpty() ? fallbackMiddle : centroid(List.copyOf(homes.values()));
    across = across(List.copyOf(homes.values()));
  }

  private static String color(String team) {
    return team.toLowerCase(Locale.ROOT);
  }

  /**
   * The unit vector across the field: perpendicular to the line between the two bases furthest
   * apart, or zero with fewer than two bases.
   */
  private static Vec3 across(List<Vec3> homes) {
    var best = Vec3.ZERO;
    for (var a : homes) {
      for (var b : homes) {
        var line = b.minus(a).horizontal();
        if (line.lengthSquared() > best.lengthSquared()) best = line;
      }
    }
    return best.isZero() ? Vec3.ZERO : new Vec3(-best.z(), 0, best.x()).normalized();
  }

  private static Vec3 centroid(List<Vec3> points) {
    var sum = Vec3.ZERO;
    for (var point : points) sum = sum.plus(point);
    return sum.scale(1.0 / points.size());
  }

  /** What a player calls {@code point}. */
  public String name(Vec3 point) {
    var bomb =
        bombs.stream()
            .filter(mark -> mark.pos().horizontalDistance(point) <= AT_BOMB)
            .min(Comparator.comparingDouble(mark -> mark.pos().horizontalDistance(point)));
    if (bomb.isPresent()) return bomb.orElseThrow().name();
    var ranked =
        bases.entrySet().stream()
            .sorted(
                Comparator.comparingDouble(
                        (Map.Entry<String, Vec3> base) -> base.getValue().horizontalDistance(point))
                    .thenComparing(Map.Entry::getKey))
            .toList();
    if (!ranked.isEmpty() && ranked.getFirst().getValue().horizontalDistance(point) <= AT_BASE)
      return ranked.getFirst().getKey() + " base";
    var area = "mid";
    if (ranked.size() >= 2) {
      var nearest = ranked.getFirst().getValue().horizontalDistance(point);
      var next = ranked.get(1).getValue().horizontalDistance(point);
      if (nearest < SIDE_SHARE * next) area = ranked.getFirst().getKey() + " side";
    }
    var compass = compass(point);
    return compass.isEmpty() ? area : compass + " " + area;
  }

  /** The compass word for how far {@code point} lies off the line between the bases, or empty. */
  private String compass(Vec3 point) {
    var offset = point.minus(middle).horizontal();
    var off = across.isZero() ? offset : across.scale(offset.dot(across));
    if (off.length() < OFF_LINE) return "";
    if (Math.abs(off.x()) >= Math.abs(off.z())) return off.x() > 0 ? "east" : "west";
    return off.z() > 0 ? "south" : "north";
  }
}
