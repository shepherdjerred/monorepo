package com.shepherdjerred.thestorm.spells.domain;

import java.time.Duration;
import java.util.Map;

/**
 * Why a cast (or a bind) did not happen. Refusals are expected outcomes, never exceptions; nothing
 * is paid when a cast is refused.
 */
public sealed interface Refusal {

  /** The spell is switched off in {@code spells.yml}. */
  record Disabled() implements Refusal {}

  /** The caster's Spellcaster level is below the spell's tier. */
  record TierTooLow(int required, int held) implements Refusal {}

  /** A quest-only spell the caster has not learned. */
  record NotLearned() implements Refusal {}

  /** The caster was silenced by another player's Silence spell. */
  record Silenced(Duration remaining) implements Refusal {}

  /** The spell's cooldown group is still cooling down. */
  record OnCooldown(Duration remaining) implements Refusal {}

  /** The caster lacks reagents; {@code missing} maps each material to how many more are needed. */
  record MissingReagents(Map<String, Integer> missing) implements Refusal {
    public MissingReagents {
      missing = Map.copyOf(missing);
    }
  }

  /** Nothing to act on, for example no creature in sight; {@code what} names it. */
  record NoTarget(String what) implements Refusal {}

  /** No safe place to arrive at. */
  record NoSafeSpot() implements Refusal {}

  /** Recall without a Mark, or a Mark in a world that is gone. */
  record NoMark() implements Refusal {}

  /** Phase found no wall to pass through. */
  record NoWall() implements Refusal {}

  /** Marks, foci and bindings are still loading after a restart. */
  record Loading() implements Refusal {}

  /** A focus bound to another player. */
  record NotYourFocus() implements Refusal {}

  /** A focus replaced by a later bind (a copy or an old one); it crumbles when used. */
  record StaleFocus() implements Refusal {}

  /** Binding needs a free inventory slot. */
  record InventoryFull() implements Refusal {}
}
