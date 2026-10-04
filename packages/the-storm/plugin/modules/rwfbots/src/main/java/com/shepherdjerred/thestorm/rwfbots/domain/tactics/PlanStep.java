package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Stance;

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

  /** Eat until healthy, moving to {@code cover} first when present. */
  record Heal(Vec3 cover) implements PlanStep {}

  /** Run to {@code goal}. */
  record Flee(Vec3 goal) implements PlanStep {}

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
      case Heal _ -> "heal";
      case Flee _ -> "flee";
      case Ability _ -> "ability";
    };
  }
}
