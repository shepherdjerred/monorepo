package com.shepherdjerred.thestorm.rwfbots.domain.map;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;

/**
 * The named places a map is played around.
 *
 * @param spawns where each team starts
 * @param bombs where each bomb and nuke stands
 */
public record NavSites(List<Site> spawns, List<Site> bombs) {

  /**
   * One site.
   *
   * @param name unique across spawns and bombs
   * @param team the team it belongs to, or empty for a nuke
   * @param cell the block: the spawn block stood on, or the TNT block itself
   */
  public record Site(String name, Optional<String> team, BlockPos cell) {

    public Site {
      if (name.isBlank()) {
        throw new IllegalArgumentException("site name must not be blank");
      }
      if (team.isPresent() && team.get().isBlank()) {
        throw new IllegalArgumentException("site team must not be blank");
      }
    }
  }

  public NavSites {
    spawns = List.copyOf(spawns);
    bombs = List.copyOf(bombs);
    var names = new HashSet<String>();
    for (var site : spawns) {
      if (!names.add(site.name())) {
        throw new IllegalArgumentException("duplicate site name: " + site.name());
      }
    }
    for (var site : bombs) {
      if (!names.add(site.name())) {
        throw new IllegalArgumentException("duplicate site name: " + site.name());
      }
    }
  }

  public Optional<Site> bomb(String name) {
    return bombs.stream().filter(site -> site.name().equals(name)).findFirst();
  }

  public Optional<Site> spawn(String name) {
    return spawns.stream().filter(site -> site.name().equals(name)).findFirst();
  }
}
