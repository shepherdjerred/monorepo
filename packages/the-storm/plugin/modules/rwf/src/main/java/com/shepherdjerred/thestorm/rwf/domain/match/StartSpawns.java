// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/game/GameTeam.java, getSpawn, and
// redwarfare-core/src/me/libraryaddict/core/utils/UtilLoc.java, getFurtherest); see
// packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.match;

import com.shepherdjerred.thestorm.rwf.domain.geometry.Spawn;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Vec3;
import java.util.List;

/**
 * Where a player starts: of their team's spawns, the one furthest from everyone already placed and
 * alive (the spawn whose nearest placed player is furthest away), turned to face the map's
 * spectator point, as Red Warfare's {@code GameTeam.getSpawn} did.
 */
final class StartSpawns {

  private StartSpawns() {}

  static Spawn pick(List<Spawn> spawns, List<Vec3> placed, Vec3 spectator) {
    if (spawns.isEmpty()) {
      throw new IllegalArgumentException("a team needs spawns");
    }
    var best = spawns.getFirst();
    var bestDistance = -1.0;
    for (var spawn : spawns) {
      var nearest = Double.MAX_VALUE;
      for (var other : placed) {
        nearest = Math.min(nearest, spawn.position().distanceTo(other));
      }
      if (nearest > bestDistance) {
        bestDistance = nearest;
        best = spawn;
      }
    }
    return new Spawn(best.position(), facing(best.position(), spectator), 0);
  }

  /** The yaw that looks from {@code from} towards {@code to} across the ground, 0 to 360. */
  static float facing(Vec3 from, Vec3 to) {
    var dx = to.x() - from.x();
    var dz = to.z() - from.z();
    if (Math.abs(dx) < 1e-9 && Math.abs(dz) < 1e-9) {
      return 0;
    }
    var degrees = (float) Math.toDegrees(Math.atan2(-dx, dz));
    var yaw = ((degrees % 360) + 360) % 360;
    return yaw >= 360 ? 0 : yaw;
  }
}
