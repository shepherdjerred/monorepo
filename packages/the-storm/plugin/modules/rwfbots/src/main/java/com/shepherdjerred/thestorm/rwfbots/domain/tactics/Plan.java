package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import java.util.List;

/**
 * A short ordered list of steps that carries out one option, such as route, then arm, then hold.
 *
 * @param option what the plan is for
 * @param steps the steps in order
 * @param index the current step
 * @param startedTick when the plan began
 */
public record Plan(Option option, List<PlanStep> steps, int index, long startedTick) {

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
    return new Plan(option, List.of(steps), 0, tick);
  }

  public boolean done() {
    return index >= steps.size();
  }

  /** The step in progress; the plan must not be done. */
  public PlanStep current() {
    return steps.get(index);
  }

  public Plan advance() {
    return new Plan(option, steps, index + 1, startedTick);
  }

  /** The first later step of type {@code type}, if any; lets a route know what it is for. */
  public <T extends PlanStep> java.util.Optional<T> upcoming(Class<T> type) {
    for (var i = index; i < steps.size(); i++) {
      if (type.isInstance(steps.get(i))) {
        return java.util.Optional.of(type.cast(steps.get(i)));
      }
    }
    return java.util.Optional.empty();
  }
}
