package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Stance;
import java.util.Optional;

/** One step of a plan: what the body is asked to achieve until the step is done. */
public sealed interface PlanStep {

  /** Get to {@code goal}. */
  record Route(Vec3 goal, Stance stance) implements PlanStep {}

  /** Kill {@code target}. */
  record Fight(CombatantId target) implements PlanStep {}

  /** Stand at the bomb and click until it is armed. */
  record Arm(BombId bomb) implements PlanStep {}

  /** Stand at the bomb and click until it is defused. */
  record Defuse(BombId bomb) implements PlanStep {}

  /** Stay at {@code pos} watching {@code watch}. */
  record Hold(Vec3 pos, Vec3 watch, Stance stance) implements PlanStep {}

  /**
   * Get to cover at {@code pos} (claiming nav node {@code node}, when it is a cover point) and hold
   * there watching {@code watch} until tick {@code until}: one bound of a cover-to-cover advance.
   */
  record Cover(Optional<Integer> node, Vec3 pos, Vec3 watch, long until) implements PlanStep {}

  /** Eat until healthy, moving to {@code cover} first when present. */
  record Heal(Vec3 cover, Optional<Integer> node) implements PlanStep {}

  /** Run to {@code goal}, claiming cover {@code node} when it is cover. */
  record Flee(Vec3 goal, Optional<Integer> node) implements PlanStep {}

  /** Trigger {@code name}. */
  record Ability(String name) implements PlanStep {}

  /** The label shown in traces. */
  default String label() {
    return switch (this) {
      case Route _ -> "route";
      case Fight _ -> "fight";
      case Arm _ -> "arm";
      case Defuse _ -> "defuse";
      case Hold _ -> "hold";
      case Cover _ -> "cover";
      case Heal _ -> "heal";
      case Flee _ -> "flee";
      case Ability _ -> "ability";
    };
  }

  /** The cover node this step holds or is heading for, if any. */
  default Optional<Integer> coverNode() {
    return switch (this) {
      case Cover cover -> cover.node();
      case Heal heal -> heal.node();
      case Flee flee -> flee.node();
      default -> Optional.empty();
    };
  }
}
