package com.shepherdjerred.thestorm.rwfbots.domain.team;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
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
 * @param side for an escort, the signed sideways offset from the planter (or the teammate it
 *     accompanies) in blocks; else 0
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

  /**
   * The prefix of a support slot's key ({@link HumanSupport}): {@code support-<human>-<n>} is the
   * {@code n}th slot that accompanies the human teammate {@code <human>}.
   */
  public static final String SUPPORT = "support-";

  /** The key of the {@code n}th support slot accompanying {@code human}. */
  public static String supportKey(CombatantId human, int n) {
    return SUPPORT + human.value() + "-" + n;
  }

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
    if (key.startsWith(SUPPORT) && kind != SlotKind.ESCORT) {
      throw new IllegalArgumentException("only an escort slot accompanies a teammate");
    }
  }

  /**
   * For a support slot, the human teammate it accompanies, named by its key; the slot moves with
   * them instead of with the planter.
   */
  public Optional<CombatantId> buddy() {
    if (!key.startsWith(SUPPORT)) return Optional.empty();
    var named = key.substring(SUPPORT.length());
    var end = named.indexOf('-');
    if (end <= 0) throw new IllegalStateException("a support slot's key names its human: " + key);
    return Optional.of(new CombatantId(Integer.parseInt(named.substring(0, end))));
  }

  public boolean paired() {
    return pair >= 0;
  }
}
