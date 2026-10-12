// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/kits/Ability.java); see
// packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.ability;

import com.shepherdjerred.thestorm.rwf.domain.combat.AttackType;
import com.shepherdjerred.thestorm.rwf.domain.combat.DamageFormula;
import java.util.OptionalDouble;
import java.util.random.RandomGenerator;

/**
 * One kit's ability: pure rules driven by what happens in a live match. Red Warfare's abilities
 * were Bukkit listeners keeping their own maps; here each holder's state is a {@link KitState} kept
 * in the match, every change goes through the {@link Arena} of one event, and randomness comes from
 * the match seed, so a match replays exactly.
 *
 * <p>Every hook has an empty default: an ability overrides only what it reacts to.
 */
public interface Ability {

  /** The id a {@code KitSpec.ability()} names. */
  String id();

  /** The match went live: {@code self} is given their kit. Returns their first state. */
  default KitState start(Fighter self, Arena arena) {
    return KitState.NONE;
  }

  /** {@code self} did something only this ability understands. */
  default void act(Fighter self, AbilityInput input, Arena arena) {}

  /** One server tick; {@code motion} is how {@code self} moved. */
  default void tick(Fighter self, Motion motion, Arena arena) {}

  /** {@code self} landed a hit on {@code hit.victim()}. */
  default void hit(Fighter self, AbilityInput.Hit hit, Arena arena) {}

  /** {@code self} was hurt. */
  default void hurt(Fighter self, AbilityInput.Hurt hurt, Arena arena) {}

  /** The match ended with {@code self} still alive, as Red Warfare's {@code GameState.End}. */
  default void ended(Fighter self, Arena arena) {}

  /** Someone died, perhaps {@code self}. Called for every living holder and for the victim. */
  default void died(Fighter self, Death death, Arena arena) {}

  /**
   * {@code actor} touched something {@code owner} placed: stepped on a landmine, struck a banner,
   * broke or used a teleporter.
   */
  default void touched(Fighter owner, Fighter actor, AbilityInput.Touch touch, Arena arena) {}

  /** Once a tick, whether or not anyone holds this ability, for what it left in the world. */
  default void anyTick(Arena arena) {}

  /** Anyone at all was hurt, as Frost's thawing fire must hear. */
  default void anyHurt(Fighter victim, AbilityInput.Hurt hurt, Arena arena) {}

  /** Anyone at all died, as a Sacrificial's bonds must hear. */
  default void anyDeath(Death death, Arena arena) {}

  /** Adjusts a hit the holder deals, before armor (Red Warfare's damage mods). */
  default DamageFormula.Hit dealing(KitState state, DamageFormula.Hit hit, RandomGenerator random) {
    return hit;
  }

  /**
   * Adjusts a hit the holder takes (Red Warfare's multipliers).
   *
   * @param direct whether someone dealt it, rather than the world
   */
  default DamageFormula.Hit taking(KitState state, DamageFormula.Hit hit, boolean direct) {
    return hit;
  }

  /** Damage this kit fixes outright, dealt or taken, as Equality's 3. */
  default OptionalDouble fixed(AttackType attack) {
    return OptionalDouble.empty();
  }

  /** How much of a hit's knockback the holder takes. */
  default double knockback() {
    return 1;
  }

  /** Whether the holder may sprint. */
  default boolean maySprint() {
    return true;
  }

  /** Whether the holder, in {@code state}, looks to the enemy like one of their own. */
  default boolean disguised(KitState state) {
    return false;
  }
}
