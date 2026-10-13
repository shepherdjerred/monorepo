// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/game/searchanddestroy/abilities/
// VampireAbility.java); see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.ability.kits;

import com.shepherdjerred.thestorm.rwf.domain.ability.Ability;
import com.shepherdjerred.thestorm.rwf.domain.ability.AbilityEffect;
import com.shepherdjerred.thestorm.rwf.domain.ability.Arena;
import com.shepherdjerred.thestorm.rwf.domain.ability.Death;
import com.shepherdjerred.thestorm.rwf.domain.ability.Fighter;
import com.shepherdjerred.thestorm.rwf.domain.ability.KitState;
import com.shepherdjerred.thestorm.rwf.domain.ability.Legacy;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import java.util.Optional;

/**
 * The Vampire starts with 8 hearts. Red Warfare rewarded it from its killstreak, which counts a
 * kill as 1 and every other share of the damage as that share, and only when the floored streak
 * went up: a kill grants a heart (2 health) and Regeneration I for 15 seconds, and a share that
 * lifts the streak past a whole number grants a single health point and 7.5 seconds; never past 20
 * hearts.
 */
public final class Vampire implements Ability {

  public static final String ID = "vampire";

  public static final double START = 16;
  public static final double MOST = 40;
  public static final double PER_KILL = 2;
  public static final double PER_ASSIST = 1;
  public static final int KILL_REGEN_TICKS = 15 * 20;
  public static final int ASSIST_REGEN_TICKS = 15 * 10;

  /**
   * A Vampire's grown max health and its killstreak.
   *
   * @param maxHealth what it has grown to
   * @param streak kills plus shares of the damage
   */
  public record State(double maxHealth, double streak) implements KitState {}

  @Override
  public String id() {
    return ID;
  }

  @Override
  public KitState start(Fighter self, Arena arena) {
    arena.effect(new AbilityEffect.MaxHealth(self.id(), START, false));
    return new State(START, 0);
  }

  @Override
  public void died(Fighter self, Death death, Arena arena) {
    if (!self.alive() || death.victim().equals(self.id())) {
      return;
    }
    var killed = death.killer().filter(self.id()::equals).isPresent();
    var share = killed ? 1.0 : death.assists().getOrDefault(self.id(), 0.0);
    if (share <= 0) {
      return;
    }
    var state = arena.state(self.id(), State.class);
    var streak = state.streak() + share;
    arena.state(self.id(), new State(state.maxHealth(), streak));
    if (Math.floor(state.streak()) >= Math.floor(streak)) {
      return;
    }
    var gain = Math.min(MOST - state.maxHealth(), killed ? PER_KILL : PER_ASSIST);
    if (gain <= 0) {
      return;
    }
    var grown = state.maxHealth() + gain;
    arena.state(self.id(), new State(grown, streak));
    arena.effect(new AbilityEffect.MaxHealth(self.id(), grown, false));
    arena.say(
        self.id(), message(killed, (int) (gain / 2), death, arena), AbilityEffect.Tone.LEGACY);
    arena.effect(
        new AbilityEffect.Potion(
            self.id(),
            "regeneration",
            0,
            killed ? KILL_REGEN_TICKS : ASSIST_REGEN_TICKS,
            Optional.empty()));
  }

  /** Red Warfare's words, "0 Heart" and all when the last point was only one. */
  private static String message(boolean killed, int hearts, Death death, Arena arena) {
    var victim = name(death.victim(), arena);
    if (killed) {
      return Legacy.GRAY
          + "You gained "
          + Legacy.GREEN
          + hearts
          + " Hearts"
          + Legacy.GRAY
          + " for killing "
          + Legacy.YELLOW
          + victim;
    }
    var killer = death.killer().map(id -> name(id, arena)).orElse("Unknown");
    return Legacy.GRAY
        + "You gained "
        + Legacy.GREEN
        + hearts
        + " Heart"
        + Legacy.GRAY
        + " for assisting "
        + Legacy.YELLOW
        + killer
        + " in killing "
        + Legacy.YELLOW
        + victim;
  }

  private static String name(CombatantId id, Arena arena) {
    return arena.fighter(id).map(Fighter::name).orElse("Unknown");
  }
}
