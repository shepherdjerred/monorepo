package com.shepherdjerred.thestorm.rwfbots.domain.map;

import static java.util.Comparator.comparingDouble;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import java.util.ArrayList;
import java.util.List;

/**
 * Nodes next to something that stops arrows, with which of sixteen directions each protects from
 * when standing and when crouched. Sector 0 faces +X and sectors grow towards +Z.
 *
 * @param points every cover point on the map
 */
public record CoverPoints(List<CoverPoint> points) {

  public static final int SECTORS = 16;

  /** How far from the eye a blocker must be to count as cover. */
  static final double REACH = 1.5;

  /** A crouching player's eye height. */
  static final double CROUCHED_EYE = 1.27;

  private static final int MIN_PROTECTED = 3;
  private static final int MAX_PROTECTED = 13;

  /**
   * One cover point.
   *
   * @param node the nav node
   * @param standingMask bit {@code s} set when sector s is covered while standing
   * @param crouchedMask bit {@code s} set when sector s is covered while crouched
   */
  public record CoverPoint(int node, int standingMask, int crouchedMask) {

    public CoverPoint {
      if (node < 0 || (standingMask >>> SECTORS) != 0 || (crouchedMask >>> SECTORS) != 0) {
        throw new IllegalArgumentException("bad cover point");
      }
    }

    public boolean protectsStanding(int sector) {
      return (standingMask >> sector & 1) != 0;
    }

    public boolean protectsCrouched(int sector) {
      return (crouchedMask >> sector & 1) != 0;
    }

    public int standingCount() {
      return Integer.bitCount(standingMask);
    }
  }

  public CoverPoints {
    points = List.copyOf(points);
  }

  /** The sector a threat at {@code threat} lies in, seen from {@code cover}. */
  public static int sectorOf(Vec3 cover, Vec3 threat) {
    var angle = Math.toDegrees(Math.atan2(threat.z() - cover.z(), threat.x() - cover.x()));
    var sector = (int) Math.round(angle / (360.0 / SECTORS));
    return ((sector % SECTORS) + SECTORS) % SECTORS;
  }

  /** The unit horizontal direction at the middle of {@code sector}. */
  public static Vec3 direction(int sector) {
    var angle = Math.toRadians(sector * (360.0 / SECTORS));
    return new Vec3(Math.cos(angle), 0, Math.sin(angle));
  }

  /** Scans every node of {@code graph} for cover in {@code grid}. */
  public static CoverPoints build(NavGraph graph, VoxelGrid grid) {
    var points = new ArrayList<CoverPoint>();
    for (var node = 0; node < graph.nodeCount(); node++) {
      var feet = graph.feet(node);
      var standing = mask(grid, feet.plus(0, CombatantView.EYE_HEIGHT, 0));
      var count = Integer.bitCount(standing);
      if (count >= MIN_PROTECTED && count <= MAX_PROTECTED) {
        var crouched = standing | mask(grid, feet.plus(0, CROUCHED_EYE, 0));
        points.add(new CoverPoint(node, standing, crouched));
      }
    }
    return new CoverPoints(points);
  }

  private static int mask(VoxelGrid grid, Vec3 eye) {
    var mask = 0;
    for (var sector = 0; sector < SECTORS; sector++) {
      var end = eye.plus(direction(sector).scale(REACH));
      if (grid.raycast(eye, end, VoxelGrid.Layer.PROJECTILE).isPresent()) {
        mask |= 1 << sector;
      }
    }
    return mask;
  }

  /**
   * Cover within {@code maxDistance} of {@code near} that protects from {@code threat}, nearest
   * first.
   */
  public List<CoverPoint> protectingFrom(
      NavGraph graph, Vec3 near, Vec3 threat, double maxDistance) {
    var out = new ArrayList<CoverPoint>();
    for (var point : points) {
      var feet = graph.feet(point.node());
      if (feet.distance(near) <= maxDistance && point.protectsStanding(sectorOf(feet, threat))) {
        out.add(point);
      }
    }
    out.sort(comparingDouble(point -> graph.feet(point.node()).distance(near)));
    return out;
  }
}
