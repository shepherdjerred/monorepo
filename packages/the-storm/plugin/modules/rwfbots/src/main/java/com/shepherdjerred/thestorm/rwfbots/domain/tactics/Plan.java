package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import java.util.List;
import java.util.Optional;

/**
 * A short ordered list of steps that carries out one option, such as route, then arm, then hold.
 *
 * @param option what the plan is for
 * @param steps the steps in order
 * @param index the current step
 * @param startedTick when the plan began
 * @param answer the enemy on its way to an own bomb that this guard plan meets, if any
 */
public record Plan(
    Option option, List<PlanStep> steps, int index, long startedTick, Optional<Answer> answer) {

  /**
   * The enemy a guard's plan answers, and how many teammates already answered it when the plan was
   * made: the first responder stands to one side of the enemy's bearing and the second to the
   * other.
   *
   * @param enemy the enemy met
   * @param rank how many teammates answered it before this guard
   */
  public record Answer(CombatantId enemy, int rank) {}

  public Plan {
    steps = List.copyOf(steps);
    if (steps.isEmpty()) {
      throw new IllegalArgumentException("a plan needs at least one step");
    }
    if (index < 0 || index > steps.size()) {
      throw new IllegalArgumentException("step index out of range: " + index);
    }
  }

  public static Plan of(Option option, long tick, PlanStep... steps) {
    return new Plan(option, List.of(steps), 0, tick, Optional.empty());
  }

  /** The same plan, meeting {@code met} on its way to an own bomb. */
  public Plan answering(Answer met) {
    return new Plan(option, steps, index, startedTick, Optional.of(met));
  }

  public boolean done() {
    return index >= steps.size();
  }

  /** The step in progress; the plan must not be done. */
  public PlanStep current() {
    return steps.get(index);
  }

  public Plan advance() {
    return new Plan(option, steps, index + 1, startedTick, answer);
  }

  /**
   * The same steps, dated from {@code tick}: a re-expanded plan keeps the age of the one it redoes.
   */
  public Plan since(long tick) {
    return new Plan(option, steps, index, tick, answer);
  }

  /** The first later step of type {@code type}, if any; lets a route know what it is for. */
  public <T extends PlanStep> Optional<T> upcoming(Class<T> type) {
    for (var i = index; i < steps.size(); i++) {
      if (type.isInstance(steps.get(i))) {
        return Optional.of(type.cast(steps.get(i)));
      }
    }
    return Optional.empty();
  }
}
