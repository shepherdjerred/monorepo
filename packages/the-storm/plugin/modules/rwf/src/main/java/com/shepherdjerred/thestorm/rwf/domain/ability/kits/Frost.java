// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/game/searchanddestroy/abilities/FrostAbility.java);
// see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.ability.kits;

import com.shepherdjerred.thestorm.rwf.domain.ability.Ability;
import com.shepherdjerred.thestorm.rwf.domain.ability.AbilityEffect;
import com.shepherdjerred.thestorm.rwf.domain.ability.AbilityInput;
import com.shepherdjerred.thestorm.rwf.domain.ability.Arena;
import com.shepherdjerred.thestorm.rwf.domain.ability.Death;
import com.shepherdjerred.thestorm.rwf.domain.ability.Fighter;
import com.shepherdjerred.thestorm.rwf.domain.ability.KitCue;
import com.shepherdjerred.thestorm.rwf.domain.ability.KitState;
import com.shepherdjerred.thestorm.rwf.domain.ability.Legacy;
import com.shepherdjerred.thestorm.rwf.domain.combat.AttackType;
import com.shepherdjerred.thestorm.rwf.domain.combat.DamageFormula;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;

/**
 * Frost: a sword hit freezes the victim's hands for 10 seconds (no switching items, no offhand, no
 * inventory) and the ability recharges for 16; fire thaws them early. Frost's own armour softens
 * every blow that armour can stop, by an eighth for each piece worn.
 */
public final class Frost implements Ability {

  public static final String ID = "frost";

  public static final Duration RECHARGE = Duration.ofSeconds(16);
  public static final Duration FROZEN = Duration.ofSeconds(10);
  public static final double PER_PIECE = 0.125;

  /** What a frozen victim is told, Red Warfare's scrambled "ab" first. */
  public static final String FROZEN_MESSAGE =
      Legacy.AQUA + Legacy.MAGIC + "ab" + Legacy.AQUA + " Your hands were covered in frost!";

  /** What a frozen victim is told when it tries its offhand holding something. */
  public static final String OFFHAND_MESSAGE =
      Legacy.AQUA + Legacy.MAGIC + "ab" + Legacy.AQUA + " Your weaker hand has been frozen!";

  /** What a victim is told when its hands thaw. */
  public static final String THAWED_MESSAGE =
      Legacy.RED + Legacy.MAGIC + "ab" + Legacy.RED + " You thawed out";

  /**
   * Who is frozen, by every Frost together.
   *
   * @param since victim to when their hands froze
   */
  public record Frozen(Map<CombatantId, Instant> since) implements KitState {

    public Frozen {
      since = Map.copyOf(since);
    }

    Frozen with(CombatantId id, Instant at) {
      var next = new HashMap<>(since);
      next.put(id, at);
      return new Frozen(next);
    }

    Frozen without(CombatantId id) {
      var next = new HashMap<>(since);
      next.remove(id);
      return new Frozen(next);
    }
  }

  @Override
  public String id() {
    return ID;
  }

  @Override
  public DamageFormula.Hit taking(KitState state, DamageFormula.Hit hit, boolean direct) {
    if (hit.attack().has(AttackType.Flag.IGNORE_ARMOR)) {
      return hit;
    }
    return hit.times(1 - PER_PIECE * hit.victimArmor().size());
  }

  @Override
  public void hit(Fighter self, AbilityInput.Hit hit, Arena arena) {
    if (!hit.type().has(AttackType.Flag.MELEE)
        || hit.weapon().filter("IRON_SWORD"::equals).isEmpty()
        || hit.victimHealth() <= 0
        || !arena.ready(self.id(), ID)) {
      return;
    }
    arena.use(self.id(), ID, RECHARGE, true);
    arena.shared(ID, frozen(arena).with(hit.victim(), arena.now()));
    arena.effect(new AbilityEffect.Hands(hit.victim(), true));
    arena.effect(new AbilityEffect.Cue(hit.victim(), KitCue.FROZEN));
    arena.say(hit.victim(), FROZEN_MESSAGE, AbilityEffect.Tone.LEGACY);
  }

  @Override
  public void anyTick(Arena arena) {
    var frozen = arena.shared(ID, Frozen.class);
    if (frozen.isEmpty()) {
      return;
    }
    var still = frozen.orElseThrow();
    for (var entry : frozen.orElseThrow().since().entrySet()) {
      if (Duration.between(entry.getValue(), arena.now()).compareTo(FROZEN) > 0) {
        still = still.without(entry.getKey());
        arena.effect(new AbilityEffect.Hands(entry.getKey(), false));
        if (arena.fighter(entry.getKey()).filter(Fighter::alive).isPresent()) {
          arena.say(entry.getKey(), THAWED_MESSAGE, AbilityEffect.Tone.LEGACY);
          arena.effect(new AbilityEffect.Cue(entry.getKey(), KitCue.THAWED));
        }
      }
    }
    arena.shared(ID, still);
  }

  @Override
  public void anyHurt(Fighter victim, AbilityInput.Hurt hurt, Arena arena) {
    var frozen = frozen(arena);
    if (hurt.type().has(AttackType.Flag.FIRE) && frozen.since().containsKey(victim.id())) {
      // Fire thaws in silence but for the message, as Red Warfare's did.
      arena.shared(ID, frozen.without(victim.id()));
      arena.effect(new AbilityEffect.Hands(victim.id(), false));
      arena.say(victim.id(), THAWED_MESSAGE, AbilityEffect.Tone.LEGACY);
    }
  }

  @Override
  public void anyDeath(Death death, Arena arena) {
    var frozen = frozen(arena);
    if (frozen.since().containsKey(death.victim())) {
      arena.shared(ID, frozen.without(death.victim()));
      arena.effect(new AbilityEffect.Hands(death.victim(), false));
    }
  }

  private static Frozen frozen(Arena arena) {
    return arena.shared(ID, Frozen.class).orElseGet(() -> new Frozen(Map.of()));
  }
}
