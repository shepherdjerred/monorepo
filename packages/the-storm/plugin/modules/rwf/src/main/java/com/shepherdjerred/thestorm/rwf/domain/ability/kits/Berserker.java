// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/game/searchanddestroy/abilities/
// BerserkerAbility.java); see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.ability.kits;

import com.shepherdjerred.thestorm.rwf.domain.ability.Ability;
import com.shepherdjerred.thestorm.rwf.domain.ability.Arena;
import com.shepherdjerred.thestorm.rwf.domain.ability.Death;
import com.shepherdjerred.thestorm.rwf.domain.ability.Fighter;
import com.shepherdjerred.thestorm.rwf.domain.ability.KitState;
import com.shepherdjerred.thestorm.rwf.domain.combat.DamageFormula;
import java.util.random.RandomGenerator;

/**
 * The Berserker's bloodlust: every whole kill on its killstreak adds 0.7 damage to every hit it
 * deals, up to 7. Red Warfare read the killstreak, where a kill counts 1 and every other share of
 * the damage counts that share, however small, and floored it.
 */
public final class Berserker implements Ability {

  public static final String ID = "berserker";

  public static final double PER_KILL = 0.7;
  public static final double MOST = 7;

  /**
   * A Berserker's killstreak.
   *
   * @param streak kills plus assist shares
   */
  public record State(double streak) implements KitState {

    /** The whole kills its bloodlust counts. */
    public int kills() {
      return (int) Math.floor(streak);
    }

    /** The damage its bloodlust adds. */
    public double bonus() {
      return Math.min(MOST, kills() * PER_KILL);
    }
  }

  @Override
  public String id() {
    return ID;
  }

  @Override
  public KitState start(Fighter self, Arena arena) {
    return new State(0);
  }

  @Override
  public void died(Fighter self, Death death, Arena arena) {
    if (!self.alive()) {
      return;
    }
    var state = arena.state(self.id(), State.class);
    if (death.killer().filter(self.id()::equals).isPresent()) {
      arena.state(self.id(), new State(state.streak() + 1));
      return;
    }
    var share = death.assists().get(self.id());
    if (share != null && share > 0) {
      arena.state(self.id(), new State(state.streak() + share));
    }
  }

  @Override
  public DamageFormula.Hit dealing(KitState state, DamageFormula.Hit hit, RandomGenerator random) {
    return state instanceof State berserker ? hit.plus(berserker.bonus()) : hit;
  }
}
