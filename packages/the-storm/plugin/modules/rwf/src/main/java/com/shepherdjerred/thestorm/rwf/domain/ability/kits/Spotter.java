package com.shepherdjerred.thestorm.rwf.domain.ability.kits;

import com.shepherdjerred.thestorm.rwf.domain.ability.Ability;
import com.shepherdjerred.thestorm.rwf.domain.ability.AbilityEffect;
import com.shepherdjerred.thestorm.rwf.domain.ability.AbilityInput;
import com.shepherdjerred.thestorm.rwf.domain.ability.Arena;
import com.shepherdjerred.thestorm.rwf.domain.ability.Fighter;
import com.shepherdjerred.thestorm.rwf.domain.ability.KitCue;
import java.time.Duration;

/**
 * The Spotter marks targets: looking through its spyglass makes every enemy in its line of sight
 * within {@link #RANGE} blocks glow for its team, and only its team, for 6 seconds. The glass
 * recharges for 30 seconds once it has marked someone.
 */
public final class Spotter implements Ability {

  public static final String ID = "spotter";

  public static final double RANGE = 60;
  public static final Duration GLOW = Duration.ofSeconds(6);
  public static final Duration RECHARGE = Duration.ofSeconds(30);

  @Override
  public String id() {
    return ID;
  }

  @Override
  public void act(Fighter self, AbilityInput input, Arena arena) {
    if (!(input instanceof AbilityInput.Spot spot)) {
      return;
    }
    if (!arena.ready(self.id(), ID)) {
      arena.say(self.id(), "Your spyglass has not recharged yet!", AbilityEffect.Tone.REFUSED);
      return;
    }
    var marked =
        spot.seen().stream()
            .distinct()
            .flatMap(id -> arena.fighter(id).stream())
            .filter(enemy -> enemy.alive() && !enemy.allyOf(self))
            .toList();
    if (marked.isEmpty()) {
      return;
    }
    arena.use(self.id(), ID, RECHARGE, true);
    arena.effect(new AbilityEffect.Cue(self.id(), KitCue.SPOTTED));
    for (var enemy : marked) {
      arena.effect(new AbilityEffect.Glow(enemy.id(), self.team(), GLOW));
    }
    var allies = arena.allies(self).stream().map(Fighter::id).toList();
    arena.say(
        allies,
        self.name()
            + " spotted "
            + marked.size()
            + (marked.size() == 1 ? " enemy" : " enemies")
            + "!",
        AbilityEffect.Tone.INFO);
  }
}
