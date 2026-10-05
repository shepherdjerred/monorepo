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
  private Instant replan = Instant.MIN;
  private java.util.List<Location> points = java.util.List.of();
  private int index;
  private double best = Double.POSITIVE_INFINITY;
  private double progress;

  double progress() {
    return progress;
  }

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
    var now = time.instant();
    if (jump) next = now.plusMillis(600);
    if (!now.isBefore(replan)) plan(target, now);
    if (waypoint == null) return;
    var at = cube.getLocation();
    var direction = waypoint.toVector().subtract(at.toVector()).setY(0);
    var distance = direction.length();
    if (Double.isFinite(best) && distance < best) progress += best - distance;
    best = Math.min(best, distance);
    if (distance < .7 && Math.abs(waypoint.getY() - at.getY()) < 1.2 && index < points.size() - 1) {
      waypoint = points.get(++index);
      best = Double.POSITIVE_INFINITY;
      direction = waypoint.toVector().subtract(at.toVector()).setY(0);
    }
    if (direction.lengthSquared() < 0.01) return;
    cube.setVelocity(
        direction.normalize().multiply(0.22).setY(jump ? 0.42 : cube.getVelocity().getY()));
  }

  private void plan(org.bukkit.entity.LivingEntity target, Instant now) {
    replan = now.plusSeconds(2);
    var path = cube.getPathfinder().findPath(target);
    if (path == null || path.getPoints().isEmpty()) {
      waypoint = null;
      return;
    }
    cube.getPathfinder().moveTo(path, 1.0);
    points = path.getPoints();
    index = Math.min(points.size() - 1, Math.max(1, path.getNextPointIndex()));
    var planned = points.get(index);
    if (waypoint == null || waypoint.distanceSquared(planned) > .01)
      best = Double.POSITIVE_INFINITY;
    waypoint = planned;
  }
}
