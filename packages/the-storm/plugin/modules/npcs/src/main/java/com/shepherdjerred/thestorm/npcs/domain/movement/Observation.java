package com.shepherdjerred.thestorm.npcs.domain.movement;

import com.shepherdjerred.thestorm.npcs.domain.geo.Rotation;
import com.shepherdjerred.thestorm.npcs.domain.geo.Vec3;
import java.util.List;
import java.util.Optional;

/**
 * What the adapter saw this tick.
 *
 * @param tick the server tick
 * @param position the NPC's feet
 * @param facing the NPC's current facing
 * @param path the navigator's answer, only while {@link Walker#pathTarget()} asks for one; empty
 *     while it has none yet (a freshly spawned navigator has to land first)
 * @param watcher the eyes of the nearest player close enough to look at, if any
 */
public record Observation(
    long tick, Vec3 position, Rotation facing, Optional<Path> path, Optional<Vec3> watcher) {

  /**
   * A path from the navigator.
   *
   * @param waypoints block-centered points from start to end
   * @param reachesTarget whether the last point is the destination, not just the closest reachable
   *     point
   */
  public record Path(List<Vec3> waypoints, boolean reachesTarget) {

    public Path {
      waypoints = List.copyOf(waypoints);
    }
  }
}
