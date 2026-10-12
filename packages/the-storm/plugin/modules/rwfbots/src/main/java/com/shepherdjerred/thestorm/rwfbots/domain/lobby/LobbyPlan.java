package com.shepherdjerred.thestorm.rwfbots.domain.lobby;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Waypoint;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * What a bot is doing in the lobby until {@code untilTick}: where it walks, what it looks at, and
 * whether it taps sneak or jumps once it gets there.
 *
 * @param activity what it is doing
 * @param path the waypoints to walk, nearest first; empty to stay put
 * @param glances what to look at once there, each until its tick; empty to look along the path
 * @param facing someone to keep facing once there, instead of the glances
 * @param sneakTaps whether to tap sneak once there
 * @param jumps whether to jump now and then once there
 * @param untilTick when the activity is over and the bot chooses again
 */
public record LobbyPlan(
    Activity activity,
    List<Waypoint> path,
    List<Glance> glances,
    Optional<UUID> facing,
    boolean sneakTaps,
    boolean jumps,
    long untilTick) {

  public LobbyPlan {
    path = List.copyOf(path);
    glances = List.copyOf(glances);
  }

  /**
   * A point to look at until a tick.
   *
   * @param at the point
   * @param untilTick when to look elsewhere
   */
  public record Glance(Vec3 at, long untilTick) {}

  /** The glance due at {@code tick}, if any. */
  public Optional<Vec3> glanceAt(long tick) {
    return glances.stream().filter(g -> tick < g.untilTick()).findFirst().map(Glance::at);
  }

  /** A short label for debug output. */
  public String label() {
    return activity.name().toLowerCase(java.util.Locale.ROOT);
  }
}
