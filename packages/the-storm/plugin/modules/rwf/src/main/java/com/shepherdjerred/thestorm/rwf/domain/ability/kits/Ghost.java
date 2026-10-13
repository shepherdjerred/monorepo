// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/game/searchanddestroy/abilities/GhostAbility.java);
// see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.ability.kits;

import com.shepherdjerred.thestorm.rwf.domain.ability.Ability;
import com.shepherdjerred.thestorm.rwf.domain.ability.AbilityEffect;
import com.shepherdjerred.thestorm.rwf.domain.ability.AbilityInput;
import com.shepherdjerred.thestorm.rwf.domain.ability.Arena;
import com.shepherdjerred.thestorm.rwf.domain.ability.Fighter;
import com.shepherdjerred.thestorm.rwf.domain.ability.KitCue;
import com.shepherdjerred.thestorm.rwf.domain.ability.KitState;
import com.shepherdjerred.thestorm.rwf.domain.ability.KitText;
import com.shepherdjerred.thestorm.rwf.domain.ability.Motion;
import com.shepherdjerred.thestorm.rwf.domain.combat.AttackType;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/**
 * The Ghost is invisible for the whole match, its name hidden from the enemy, but not perfectly:
 * held items, sprint particles and flames show as they do on any invisible player, every hurt (but
 * the poison's) bursts in its team's colour, and an arrow that hits it stays stuck in it for ten
 * seconds. The Wraith ({@link Wraith}) shares all of this.
 */
public class Ghost implements Ability {

  public static final String ID = "ghost";

  /** How long an arrow stays stuck in a ghost. */
  public static final Duration STUCK = Duration.ofSeconds(10);

  /**
   * The arrows stuck in a ghost.
   *
   * @param arrows when each one hit, oldest first
   */
  public record State(List<Instant> arrows) implements KitState {

    public State {
      arrows = List.copyOf(arrows);
    }
  }

  @Override
  public String id() {
    return ID;
  }

  @Override
  public KitState start(Fighter self, Arena arena) {
    arena.effect(new AbilityEffect.Visibility(self.id(), AbilityEffect.Seen.GHOST));
    return new State(List.of());
  }

  @Override
  public void hurt(Fighter self, AbilityInput.Hurt hurt, Arena arena) {
    if (hurt.type().equals(AttackType.POISON) || hurt.type().equals(AttackType.WITHER_POISON)) {
      return;
    }
    arena.effect(new AbilityEffect.Cue(self.id(), KitCue.GHOST_HIT));
    if (!hurt.type().has(AttackType.Flag.PROJECTILE)) {
      return;
    }
    arena.say(
        self.id(),
        KitText.AQUA + KitText.MAGIC + "sd" + KitText.AQUA + "You were slammed with a arrow!",
        AbilityEffect.Tone.INFO);
    var arrows = new ArrayList<>(ghost(self, arena).arrows());
    arrows.add(arena.now());
    keep(self, arena, new State(arrows));
  }

  @Override
  public void tick(Fighter self, Motion motion, Arena arena) {
    var arrows = ghost(self, arena).arrows();
    if (arrows.isEmpty() || !arena.now().isAfter(arrows.getFirst().plus(STUCK))) {
      return;
    }
    var left = new ArrayList<>(arrows);
    while (!left.isEmpty() && arena.now().isAfter(left.getFirst().plus(STUCK))) {
      arena.effect(new AbilityEffect.Unstick(self.id(), left.removeFirst()));
    }
    keep(self, arena, new State(left));
  }

  /** The ghost part of the holder's state. */
  protected State ghost(Fighter self, Arena arena) {
    return arena.state(self.id(), State.class);
  }

  /** Stores the ghost part of the holder's state. */
  protected void keep(Fighter self, Arena arena, State ghost) {
    arena.state(self.id(), ghost);
  }
}
