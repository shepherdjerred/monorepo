package com.shepherdjerred.thestorm.npcs.domain.behavior;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.npcs.domain.behavior.Behavior.Scored;
import com.shepherdjerred.thestorm.npcs.domain.behavior.Behavior.Status;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

final class BehaviorTest {

  /** A context that records which leaves ran. */
  private static final class Trace {
    final List<String> ran = new ArrayList<>();
    double hunger;
    double fatigue;
  }

  private static Behavior<Trace> leaf(String name, Status status) {
    return Behavior.action(
        trace -> {
          trace.ran.add(name);
          return status;
        });
  }

  @Test
  void sequenceStopsAtTheFirstChildThatDoesNotSucceed() {
    var trace = new Trace();
    var tree =
        Behavior.sequence(
            List.of(
                leaf("a", Status.SUCCESS), leaf("b", Status.RUNNING), leaf("c", Status.SUCCESS)));
    assertThat(tree.tick(trace)).isEqualTo(Status.RUNNING);
    assertThat(trace.ran).containsExactly("a", "b");

    var failing = new Trace();
    assertThat(
            Behavior.sequence(List.of(leaf("a", Status.FAILURE), leaf("b", Status.SUCCESS)))
                .tick(failing))
        .isEqualTo(Status.FAILURE);
    assertThat(failing.ran).containsExactly("a");
  }

  @Test
  void sequenceSucceedsWhenEveryChildDoes() {
    var trace = new Trace();
    assertThat(
            Behavior.sequence(List.of(leaf("a", Status.SUCCESS), leaf("b", Status.SUCCESS)))
                .tick(trace))
        .isEqualTo(Status.SUCCESS);
    assertThat(trace.ran).containsExactly("a", "b");
  }

  @Test
  void selectorStopsAtTheFirstChildThatDoesNotFail() {
    var trace = new Trace();
    var tree =
        Behavior.selector(
            List.of(
                leaf("a", Status.FAILURE), leaf("b", Status.SUCCESS), leaf("c", Status.SUCCESS)));
    assertThat(tree.tick(trace)).isEqualTo(Status.SUCCESS);
    assertThat(trace.ran).containsExactly("a", "b");

    var running = new Trace();
    assertThat(
            Behavior.selector(List.of(leaf("a", Status.RUNNING), leaf("b", Status.SUCCESS)))
                .tick(running))
        .isEqualTo(Status.RUNNING);
    assertThat(running.ran).containsExactly("a");
  }

  @Test
  void selectorFailsWhenEveryChildDoes() {
    var trace = new Trace();
    assertThat(
            Behavior.selector(List.of(leaf("a", Status.FAILURE), leaf("b", Status.FAILURE)))
                .tick(trace))
        .isEqualTo(Status.FAILURE);
    assertThat(trace.ran).containsExactly("a", "b");
  }

  @Test
  void conditionsGuardBranchesReactively() {
    var trace = new Trace();
    var tree =
        Behavior.<Trace>selector(
            List.of(
                Behavior.sequence(
                    List.of(Behavior.condition(t -> t.hunger > 0.5), leaf("eat", Status.RUNNING))),
                leaf("work", Status.RUNNING)));
    assertThat(tree.tick(trace)).isEqualTo(Status.RUNNING);
    trace.hunger = 0.9;
    tree.tick(trace);
    trace.hunger = 0.1;
    tree.tick(trace);
    // Stateless: the higher branch interrupts work as soon as its condition holds, and lets go.
    assertThat(trace.ran).containsExactly("work", "eat", "work");
  }

  @Test
  void inverterSwapsSuccessAndFailureOnly() {
    var trace = new Trace();
    assertThat(Behavior.inverter(leaf("a", Status.SUCCESS)).tick(trace)).isEqualTo(Status.FAILURE);
    assertThat(Behavior.inverter(leaf("b", Status.FAILURE)).tick(trace)).isEqualTo(Status.SUCCESS);
    assertThat(Behavior.inverter(leaf("c", Status.RUNNING)).tick(trace)).isEqualTo(Status.RUNNING);
  }

  @Test
  void utilityTriesOptionsFromMostToLeastWanted() {
    var trace = new Trace();
    var tree =
        Behavior.<Trace>utility(
            List.of(
                new Scored<>(t -> t.hunger, leaf("eat", Status.FAILURE)),
                new Scored<>(t -> t.fatigue, leaf("sleep", Status.SUCCESS)),
                new Scored<>(t -> 0.1, leaf("idle", Status.SUCCESS))));
    trace.hunger = 0.8;
    trace.fatigue = 0.5;
    assertThat(tree.tick(trace)).isEqualTo(Status.SUCCESS);
    // Eating scored highest but failed, so the next best ran.
    assertThat(trace.ran).containsExactly("eat", "sleep");
  }

  @Test
  void utilitySkipsOptionsScoringZeroAndBreaksTiesInOrder() {
    var trace = new Trace();
    var tree =
        Behavior.<Trace>utility(
            List.of(
                new Scored<>(t -> 0, leaf("never", Status.SUCCESS)),
                new Scored<>(t -> 0.5, leaf("first", Status.SUCCESS)),
                new Scored<>(t -> 0.5, leaf("second", Status.SUCCESS))));
    assertThat(tree.tick(trace)).isEqualTo(Status.SUCCESS);
    assertThat(trace.ran).containsExactly("first");

    var none =
        Behavior.<Trace>utility(List.of(new Scored<>(t -> -1, leaf("never", Status.SUCCESS))));
    assertThat(none.tick(new Trace())).isEqualTo(Status.FAILURE);
  }

  @Test
  void compositesNeedChildren() {
    assertThatThrownBy(() -> Behavior.<Trace>sequence(List.of()))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> Behavior.<Trace>selector(List.of()))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> Behavior.<Trace>utility(List.of()))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
