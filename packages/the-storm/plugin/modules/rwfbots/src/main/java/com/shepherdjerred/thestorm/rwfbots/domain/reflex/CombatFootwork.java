package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.AABB;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.GridBounds;
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

  /**
   * Whether a combat step keeps the sprint: a player strafing in contact holds forward as well, so
   * a step towards {@code toTarget} or across it sprints, and only backing off drops it.
   */
  public static boolean sprintable(Vec3 step, Vec3 toTarget) {
    var horizontal = step.horizontal();
    return !horizontal.isZero()
        && horizontal.normalized().dot(toTarget.horizontal().normalized()) > -SPRINT_SLACK;
  }

  /** How far a strafe may drift backwards, as a share of the step, and still count as across. */
  static final double SPRINT_SLACK = 0.05;

  /** Ticks after a hit during which an optional jump only carries the body further with it. */
  public static final long REEL_TICKS = 10;

  /**
   * Whether {@code self} is still reeling from a hit: a jump now leaves the ground while knockback
   * is carrying it, so the blow throws it further and the body cannot steer back until it lands.
   */
  public static boolean reeling(CombatantView self, long now) {
    return self.lastHurtTick() >= 0 && now - self.lastHurtTick() < REEL_TICKS;
  }

  /**
   * How far a plain blow's push is checked for ground, in blocks: rwf's 1.8 knockback carries a
   * body about three blocks.
   */
  public static final double PUSH_REACH = 3;

  /**
   * How far a sprinting attacker's blow is checked: its knockback level carries a body about six
   * and a half blocks before it comes down (7.6 with the slide), less when the body presses in.
   */
  public static final double SPRINT_PUSH_REACH = 6;

  /** Ground more than this many blocks under the feet is a fall that hurts, or the void. */
  public static final int DROP_DEPTH = 4;

  private static final double PUSH_STEP = 0.5;

  /**
   * Whether a blow pushing a body standing at {@code feet} along {@code push} carries it over a
   * drop within {@code reach}: a column without ground within {@link #DROP_DEPTH} under the path
   * before a wall would stop it. {@link #safe} only checks the step ahead; knockback goes the other
   * way, and 26 production bot deaths came off edges after a blow.
   */
  public static boolean dropAlong(VoxelGrid grid, Vec3 feet, Vec3 push, double reach) {
    var along = push.horizontal();
    if (along.isZero()) return false;
    var unit = along.normalized();
    var floor = cell(feet.y() - 0.1);
    for (var step = PUSH_STEP; step <= reach + 1e-9; step += PUSH_STEP) {
      var x = cell(feet.x() + unit.x() * step);
      var z = cell(feet.z() + unit.z() * step);
      if (solid(grid, x, floor + 1, z) && solid(grid, x, floor + 2, z)) return false;
      if (!grounded(grid, x, floor, z)) return true;
    }
    return false;
  }

  /** How far a blow carries its victim: further when the attacker sprints. */
  public static double pushReach(boolean sprinting) {
    return sprinting ? SPRINT_PUSH_REACH : PUSH_REACH;
  }

  /**
   * Whether the column at {@code x}, {@code z} has ground within {@link #DROP_DEPTH} of a floor.
   */
  static boolean grounded(VoxelGrid grid, int x, int floor, int z) {
    for (var y = floor + 1; y > floor - DROP_DEPTH; y--) {
      if (solid(grid, x, y, z)) return true;
    }
    return false;
  }

  /**
   * A cell that holds a body up. Below the baked map is the void, not the solid wall movement
   * treats every cell outside it as; beside it the wall stands, as nobody walks there.
   */
  private static boolean solid(VoxelGrid grid, int x, int y, int z) {
    return y >= grid.bounds().origin().y() && grid.blocks(x, y, z, VoxelGrid.Layer.MOVEMENT);
  }

  /** Whether {@code feet} stand over ground no deeper than {@link #DROP_DEPTH}. */
  static boolean grounded(VoxelGrid grid, Vec3 feet) {
    return grounded(grid, cell(feet.x()), cell(feet.y() - 0.1), cell(feet.z()));
  }

  /**
   * How many blocks below its floor a combat step may come down: off a rail or a fence top a blow
   * left the body on, or a step of a stair. A deeper drop belongs to navigation.
   */
  static final int STEP_DOWN = 2;

  public static boolean safe(VoxelGrid grid, CombatantView self, Vec3 heading) {
    if (heading.isZero()) return true;
    var delta = heading.horizontal().normalized();
    if (self.onGround() && !stepSupported(grid, self.pos().plus(delta))) {
      return false;
    }
    return clearSweep(grid, self.pos(), delta);
  }

  /** Whether ground under {@code feet} lies within {@link #STEP_DOWN} of their floor. */
  private static boolean stepSupported(VoxelGrid grid, Vec3 feet) {
    var floor = cell(feet.y() - 0.1);
    for (var y = floor; y > floor - 1 - STEP_DOWN; y--) {
      if (solid(grid, cell(feet.x()), y, cell(feet.z()))) return true;
    }
    return false;
  }

  /** Every possible future steering direction must still land on certified supported terrain. */
  public static boolean safeJump(
      NavArtifact nav, CombatantView self, MovementMotor.Control control, long now) {
    if (!launchable(self, now)) return false;
    var envelope = envelope(self, control);
    return envelope.isPresent() && clearEnvelope(nav, self.pos(), envelope.orElseThrow());
  }

  /** The body's half diagonal: how far past its centre its box reaches. */
  private static final double HALF_DIAGONAL =
      Math.hypot(AABB.PLAYER_HALF_WIDTH, AABB.PLAYER_HALF_WIDTH);

  /** The cells a hop's body sweeps itself, within its half width of the line. */
  private static final double HOP_BODY = AABB.PLAYER_HALF_WIDTH + 0.05;

  /**
   * Whether a sprint jump that keeps steering along {@code direction} stays over baked standable
   * ground with clear headroom: {@link #safeJump}'s certificate over the corridor the flight can
   * cover, rather than every direction a fight could turn it. The body's own line needs headroom
   * for the whole arc; beside it, within the drift a replan could steer it, a wall only stops the
   * body, so it counts as safe, while an opening or water does not. A straight run along a wall is
   * safe to hop; the full envelope refuses it.
   */
  public static boolean safeHop(NavArtifact nav, CombatantView self, Vec3 direction, long now) {
    if (direction.horizontal().isZero() || !launchable(self, now)) return false;
    // A hop launches from the speed the body carries, plus its sprint input and the boost.
    var carried = Math.max(self.vel().horizontal().length(), MovementMotor.SPRINT_SPEED);
    var heading = direction.horizontal().normalized();
    return flight(MovementMotor.hop(heading.scale(carried), heading))
        .map(
            envelope ->
                new Corridor(
                    self.pos(),
                    self.pos().plus(heading.scale(envelope.radius())),
                    HALF_DIAGONAL + envelope.drift(),
                    self.pos().y() + envelope.rise()))
        .filter(corridor -> corridor.inside(nav.graph().bounds()))
        .filter(corridor -> clearCorridor(nav, corridor))
        .isPresent();
  }

  /**
   * The ground a straight hop may cover.
   *
   * @param from the take-off
   * @param to where the flight carries along its line
   * @param drift how far beside the line it may land
   * @param peak the highest its feet climb
   */
  private record Corridor(Vec3 from, Vec3 to, double drift, double peak) {
    int minX() {
      return cell(Math.min(from.x(), to.x()) - drift);
    }

    int maxX() {
      return cell(Math.max(from.x(), to.x()) + drift);
    }

    int minZ() {
      return cell(Math.min(from.z(), to.z()) - drift);
    }

    int maxZ() {
      return cell(Math.max(from.z(), to.z()) + drift);
    }

    boolean inside(GridBounds bounds) {
      return minX() >= bounds.origin().x()
          && minZ() >= bounds.origin().z()
          && maxX() < bounds.origin().x() + bounds.sizeX()
          && maxZ() < bounds.origin().z() + bounds.sizeZ();
    }
  }

  /**
   * The body's own line needs standable ground and headroom for the whole arc; beside it a wall
   * only stops the body, while an opening or water could take it.
   */
  private static boolean clearCorridor(NavArtifact nav, Corridor corridor) {
    var feet = cell(corridor.from().y());
    for (var z = corridor.minZ(); z <= corridor.maxZ(); z++) {
      for (var x = corridor.minX(); x <= corridor.maxX(); x++) {
        var away = squareToSegment(x, z, corridor.from(), corridor.to());
        var ground = new BlockPos(x, feet, z);
        var safe =
            away > corridor.drift()
                || (away <= HOP_BODY
                    ? standable(nav, ground) && clearColumn(nav.grid(), ground, corridor.peak())
                    : standable(nav, ground) || wall(nav.grid(), ground));
        if (!safe) return false;
      }
    }
    return true;
  }

  /** A baked node on solid support, neither water nor a ladder or vine. */
  private static boolean standable(NavArtifact nav, BlockPos cell) {
    var node = nav.graph().nodeAt(cell);
    return node.isPresent()
        && !nav.graph().water().contains(cell)
        && !nav.graph().climbable(node.getAsInt())
        && nav.grid().blocks(cell.x(), cell.y() - 1, cell.z(), VoxelGrid.Layer.MOVEMENT);
  }

  /**
   * A cell the body slides along rather than lands on: two blocks high at the take-off height. A
   * hop's apex clears anything lower, so a body drifting over a deck's rail or an island's edge
   * fence comes down on it, or past it over the drop it guards.
   */
  private static boolean wall(VoxelGrid grid, BlockPos cell) {
    return grid.blocks(cell.x(), cell.y(), cell.z(), VoxelGrid.Layer.MOVEMENT)
        && grid.blocks(cell.x(), cell.y() + 1, cell.z(), VoxelGrid.Layer.MOVEMENT);
  }

  /** A grounded body on a full block's top, with no effect that changes a jump's arc. */
  private static boolean launchable(CombatantView self, long now) {
    return self.onGround()
        && Math.abs(self.pos().y() - Math.rint(self.pos().y())) <= 0.02
        && self.traversal().slowFallingUntilTick() <= now
        && self.traversal().jumpBoostUntilTick() <= now;
  }

  /** Horizontal distance from the unit square at ({@code x}, {@code z}) to a segment. */
  private static double squareToSegment(int x, int z, Vec3 from, Vec3 to) {
    var best = Double.POSITIVE_INFINITY;
    for (var step = 0; step <= 16; step++) {
      var point = from.plus(to.minus(from).scale(step / 16.0));
      var nearestX = Math.clamp(point.x(), x, x + 1.0);
      var nearestZ = Math.clamp(point.z(), z, z + 1.0);
      best = Math.min(best, Math.hypot(point.x() - nearestX, point.z() - nearestZ));
    }
    return best;
  }

  /**
   * A flight's reach.
   *
   * @param radius how far it carries along its launch
   * @param rise how high it climbs
   * @param drift how far the strongest air input steers it across its launch before it lands
   */
  private record Envelope(double radius, double rise, double drift) {}

  private static Optional<Envelope> envelope(CombatantView self, MovementMotor.Control control) {
    // Recovery may redirect the first move. Ground steering stays within this momentum/speed cap.
    var groundSpeed =
        Math.max(
            self.vel().horizontal().length(),
            control.sprint() ? MovementMotor.SPRINT_SPEED : MovementMotor.WALK_SPEED);
    return flight(MovementMotor.jump(new Vec3(groundSpeed, 0, 0), control.sprint()));
  }

  /**
   * The reach and rise of a flight launched at {@code launch}, with the strongest air input a body
   * can add every tick.
   */
  private static Optional<Envelope> flight(Vec3 launch) {
    var speed = launch.horizontal().length();
    var vertical = launch.y();
    var height = 0.0;
    var peak = 0.0;
    var radius = 0.0;
    var maximumAirInput =
        MovementMotor.steer(Vec3.ZERO, new MovementMotor.Control(new Vec3(1, 0, 0), true, false, 1))
            .length();
    var across = 0.0;
    var drift = 0.0;
    for (var tick = 0; tick < 20; tick++) {
      radius += speed;
      height += vertical;
      drift += across;
      peak = Math.max(peak, height);
      if (vertical <= 0 && height <= 0) return Optional.of(new Envelope(radius, peak, drift));
      speed = speed * (tick == 0 ? 0.546 : 0.91) + maximumAirInput;
      across = across * (tick == 0 ? 0.546 : 0.91) + maximumAirInput;
      vertical = (vertical - 0.08) * 0.98;
    }
    return Optional.empty();
  }

  private static boolean clearEnvelope(NavArtifact nav, Vec3 source, Envelope envelope) {
    var radius = envelope.radius() + HALF_DIAGONAL;
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
