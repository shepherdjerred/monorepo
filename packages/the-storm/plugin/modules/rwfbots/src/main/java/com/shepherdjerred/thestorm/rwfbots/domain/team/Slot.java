package com.shepherdjerred.thestorm.rwfbots.domain.team;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombId;
import java.util.Optional;

/**
 * One position of a team's playbook.
 *
 * @param key a name stable across deals (such as {@code lane-0}), so a bot can keep its slot
 * @param kind what kind of position it is
 * @param role the role its holder plays
 * @param pos where to stand; for an escort, where the wedge point was when dealt
 * @param watch the point to keep an eye on from there
 * @param lane the team lane the slot lies on and routes along, or -1
 * @param pair slots sharing a pair number bound forward together, one moving while the other holds;
 *     -1 when unpaired
 * @param bomb the bomb a planter arms
 * @param side for an escort, the signed sideways offset from the planter in blocks; else 0
 */
public record Slot(
    String key,
    SlotKind kind,
    Role role,
    Vec3 pos,
    Vec3 watch,
    int lane,
    int pair,
    Optional<BombId> bomb,
    double side) {

  public Slot {
    if (key.isBlank()) {
      throw new IllegalArgumentException("a slot needs a key");
    }
    if (lane < -1 || pair < -1) {
      throw new IllegalArgumentException("lane and pair are -1 or an index");
    }
    if (kind == SlotKind.PLANT && bomb.isEmpty()) {
      throw new IllegalArgumentException("a plant slot names its bomb");
    }
    if (!Double.isFinite(side) || (kind != SlotKind.ESCORT && side != 0)) {
      throw new IllegalArgumentException("only escorts stand to the side of the planter");
    }
  }

  public boolean paired() {
    return pair >= 0;
  }
}
