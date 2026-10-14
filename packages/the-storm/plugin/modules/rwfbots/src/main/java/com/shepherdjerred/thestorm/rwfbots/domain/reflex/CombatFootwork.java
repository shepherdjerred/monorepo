package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.AABB;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.map.VoxelGrid;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import java.util.Optional;

/** Optional combat dodges stay in clear supported space; deliberate drops belong to navigation. */
public final class CombatFootwork {
  private CombatFootwork() {}

  public static Vec3 steer(VoxelGrid grid, CombatantView self, Vec3 preferred, Vec3 alternative) {
    if (safe(grid, self, preferred)) return preferred;
    return safe(grid, self, alternative) ? alternative : Vec3.ZERO;
  }

  public static boolean safe(VoxelGrid grid, CombatantView self, Vec3 heading) {
    if (heading.isZero()) return true;
    var delta = heading.horizontal().normalized();
    if (self.onGround()
        && !grid.blocks(
            cell(self.pos().x() + delta.x()),
            cell(self.pos().y() - 0.1),
            cell(self.pos().z() + delta.z()),
            VoxelGrid.Layer.MOVEMENT)) {
      return false;
    }
    return clearSweep(grid, self.pos(), delta);
  }

  /** Every possible future steering direction must still land on certified supported terrain. */
  public static boolean safeJump(
      NavArtifact nav, CombatantView self, MovementMotor.Control control, long now) {
    if (!self.onGround()
        || Math.abs(self.pos().y() - Math.rint(self.pos().y())) > 0.02
        || self.traversal().slowFallingUntilTick() > now
        || self.traversal().jumpBoostUntilTick() > now) return false;
    var envelope = envelope(self, control);
    return envelope.isPresent() && clearEnvelope(nav, self.pos(), envelope.orElseThrow());
  }

  private record Envelope(double radius, double rise) {}

  private static Optional<Envelope> envelope(CombatantView self, MovementMotor.Control control) {
    // Recovery may redirect the first move. Ground steering stays within this momentum/speed cap.
    var groundSpeed =
        Math.max(
            self.vel().horizontal().length(),
            control.sprint() ? MovementMotor.SPRINT_SPEED : MovementMotor.WALK_SPEED);
    var launch = MovementMotor.jump(new Vec3(groundSpeed, 0, 0), control.sprint());
    var speed = launch.horizontal().length();
    var vertical = launch.y();
    var height = 0.0;
    var peak = 0.0;
    var radius = 0.0;
    var maximumAirInput =
        MovementMotor.steer(Vec3.ZERO, new MovementMotor.Control(new Vec3(1, 0, 0), true, false, 1))
            .length();
    for (var tick = 0; tick < 20; tick++) {
      radius += speed;
      height += vertical;
      peak = Math.max(peak, height);
      if (vertical <= 0 && height <= 0) return Optional.of(new Envelope(radius, peak));
      speed = speed * (tick == 0 ? 0.546 : 0.91) + maximumAirInput;
      vertical = (vertical - 0.08) * 0.98;
    }
    return Optional.empty();
  }

  private static boolean clearEnvelope(NavArtifact nav, Vec3 source, Envelope envelope) {
    var radius = envelope.radius() + Math.hypot(AABB.PLAYER_HALF_WIDTH, AABB.PLAYER_HALF_WIDTH);
    var bounds = nav.graph().bounds();
    if (source.x() - radius < bounds.origin().x()
        || source.z() - radius < bounds.origin().z()
        || source.x() + radius >= bounds.origin().x() + bounds.sizeX()
        || source.z() + radius >= bounds.origin().z() + bounds.sizeZ()) return false;
    for (var z = cell(source.z() - radius); z <= cell(source.z() + radius); z++) {
      for (var x = cell(source.x() - radius); x <= cell(source.x() + radius); x++) {
        var nearestX = Math.clamp(source.x(), x, x + 1.0);
        var nearestZ = Math.clamp(source.z(), z, z + 1.0);
        if (Math.hypot(source.x() - nearestX, source.z() - nearestZ) > radius) continue;
        var ground = new BlockPos(x, cell(source.y()), z);
        if (!certifiedGround(nav, ground)
            || !clearColumn(nav.grid(), ground, source.y() + envelope.rise())) return false;
      }
    }
    return true;
  }

  private static boolean clearColumn(VoxelGrid grid, BlockPos ground, double peakFeet) {
    for (var y = ground.y(); y <= cell(peakFeet + AABB.PLAYER_HEIGHT - 1e-6); y++) {
      if (grid.blocks(ground.x(), y, ground.z(), VoxelGrid.Layer.MOVEMENT)) return false;
    }
    return true;
  }

  private static boolean certifiedGround(NavArtifact nav, BlockPos cell) {
    var graph = nav.graph();
    var node = graph.nodeAt(cell);
    if (node.isEmpty() || graph.water().contains(cell)) return false;
    // A compressed node may be ladder-only. A baked leap source requires standable support.
    for (var edge = graph.edgeStart(node.getAsInt());
        edge < graph.edgeEnd(node.getAsInt());
        edge++) {
      if (graph.edgeHop(edge) == Hop.LEAP) return true;
    }
    return false;
  }

  private static boolean clearSweep(VoxelGrid grid, Vec3 pos, Vec3 delta) {
    var radius = AABB.PLAYER_HALF_WIDTH - 1e-6;
    var minX = cell(pos.x() + Math.min(0, delta.x()) - radius);
    var maxX = cell(pos.x() + Math.max(0, delta.x()) + radius);
    var minZ = cell(pos.z() + Math.min(0, delta.z()) - radius);
    var maxZ = cell(pos.z() + Math.max(0, delta.z()) + radius);
    // Ignore the lower 0.6 blocks, which ordinary player steps may clear.
    for (var y = cell(pos.y() + 0.65); y <= cell(pos.y() + 1.75); y++) {
      for (var z = minZ; z <= maxZ; z++) {
        for (var x = minX; x <= maxX; x++) {
          if (grid.blocks(x, y, z, VoxelGrid.Layer.MOVEMENT)) return false;
        }
      }
    }
    return true;
  }

  private static int cell(double coordinate) {
    return (int) Math.floor(coordinate);
  }
}
