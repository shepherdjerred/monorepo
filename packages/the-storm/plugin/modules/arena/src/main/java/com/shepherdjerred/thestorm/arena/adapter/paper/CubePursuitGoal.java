package com.shepherdjerred.thestorm.arena.adapter.paper;

import com.destroystokyo.paper.entity.ai.Goal;
import com.destroystokyo.paper.entity.ai.GoalKey;
import com.destroystokyo.paper.entity.ai.GoalType;
import java.time.Instant;
import java.time.InstantSource;
import java.util.EnumSet;
import org.bukkit.Location;
import org.bukkit.NamespacedKey;
import org.bukkit.entity.AbstractCubeMob;
import org.jspecify.annotations.Nullable;

/**
 * Hops follow real path waypoints instead of harmless cube wandering. Native contact combat stays.
 */
final class CubePursuitGoal implements Goal<AbstractCubeMob> {
  private static final GoalKey<AbstractCubeMob> KEY =
      GoalKey.of(AbstractCubeMob.class, new NamespacedKey("thestorm", "cube_pursuit"));
  private final AbstractCubeMob cube;
  private final InstantSource time;
  private Instant next = Instant.MIN;
  private @Nullable Location waypoint;

  CubePursuitGoal(AbstractCubeMob cube, InstantSource time) {
    this.cube = cube;
    this.time = time;
  }

  @Override
  public boolean shouldActivate() {
    return cube.getTarget() != null && !cube.isDead();
  }

  @Override
  public EnumSet<GoalType> getTypes() {
    return EnumSet.of(GoalType.MOVE, GoalType.LOOK, GoalType.JUMP);
  }

  @Override
  public GoalKey<AbstractCubeMob> getKey() {
    return KEY;
  }

  @Override
  public void tick() {
    var target = cube.getTarget();
    if (target == null) return;
    cube.lookAt(target);
    var jump = cube.isOnGround() && !time.instant().isBefore(next);
    if (jump) {
      next = time.instant().plusMillis(600);
      var path = cube.getPathfinder().findPath(target);
      if (path != null) {
        cube.getPathfinder().moveTo(path, 1.0);
        var points = path.getPoints();
        waypoint = points.get(Math.min(points.size() - 1, Math.max(1, path.getNextPointIndex())));
      } else {
        waypoint = null;
      }
    }
    if (waypoint == null) return;
    var at = cube.getLocation();
    var direction = waypoint.toVector().subtract(at.toVector()).setY(0);
    if (direction.lengthSquared() < 0.01) return;
    cube.setVelocity(
        direction.normalize().multiply(0.22).setY(jump ? 0.42 : cube.getVelocity().getY()));
  }
}
